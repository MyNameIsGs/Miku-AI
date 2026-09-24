import os
import sys
import shutil
import tempfile
import traceback
import unicodedata  # Forzar importación previa
import subprocess
import json
import base64
import io

# 1. Limpieza de carpetas temporales viejas de PyInstaller
def cleanup_old_mei_folders():
    """Borra carpetas _MEI de ejecuciones anteriores que quedaron abandonadas."""
    temp_dir = tempfile.gettempdir()
    current_mei = getattr(sys, "_MEIPASS", None)

    for entry in os.listdir(temp_dir):
        if entry.startswith("_MEI"):
            full_path = os.path.join(temp_dir, entry)
            if full_path == current_mei:
                continue
            try:
                shutil.rmtree(full_path, ignore_errors=True)
                print(f"[CLEANUP] Carpeta temporal vieja eliminada: {entry}")
            except Exception:
                pass

cleanup_old_mei_folders()

# 2. Establecer el directorio de trabajo en %TEMP%
system_temp = tempfile.gettempdir()
os.chdir(system_temp)

import threading
import time as time_module

import numpy as np
import sounddevice as sd
import onnxruntime as ort
from flask import Flask, request, jsonify
from flask_cors import CORS
from nanowakeword import NanoInterpreter
from tts_with_rvc import TTS_RVC
import asyncio
import wave
import edge_tts
from lipsync_text import visemes_from_words
from faster_whisper import WhisperModel
from waitress import serve

app = Flask(__name__)
CORS(app)

# Ruta a Rhubarb: busca en PyInstaller (_MEIPASS), junto al ejecutable, o rutas conocidas
def resolve_rhubarb_path():
    candidates = []
    if hasattr(sys, "_MEIPASS"):
        candidates.append(os.path.join(sys._MEIPASS, "rhubarb", "rhubarb.exe"))
    if getattr(sys, "frozen", False):
        candidates.append(os.path.join(os.path.dirname(sys.executable), "rhubarb", "rhubarb.exe"))
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "rhubarb", "rhubarb.exe"))
    candidates.append(r"C:\Users\sebas\MikuAI-Project\Miku-Voice-Service\rhubarb\rhubarb.exe")
    candidates.append(r"C:\Users\sebas\MikuAI-Project\Miku-AI\src-tauri\binaries\rhubarb\rhubarb.exe")
    candidates.append(r"C:\Users\sebas\MikuAI-Project\Miku-AI\src-tauri\target\debug\rhubarb\rhubarb.exe")

    for p in candidates:
        if os.path.isfile(p):
            return p
    return candidates[0] if candidates else "rhubarb.exe"

RHUBARB_PATH = resolve_rhubarb_path()


# Tarea 5.4: mismo criterio de resolución de ruta que Rhubarb -- PyInstaller
# (_MEIPASS), junto al ejecutable, o junto al script en modo desarrollo.
def resolve_wake_word_model_path():
    candidates = []
    if hasattr(sys, "_MEIPASS"):
        candidates.append(os.path.join(sys._MEIPASS, "wake_word", "hey_miku_v1.onnx"))
    if getattr(sys, "frozen", False):
        candidates.append(os.path.join(os.path.dirname(sys.executable), "wake_word", "hey_miku_v1.onnx"))
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "wake_word", "hey_miku_v1.onnx"))

    for p in candidates:
        if os.path.isfile(p):
            return p
    return candidates[0] if candidates else "wake_word/hey_miku_v1.onnx"


# Tarea 8.1: mismo criterio de resolución de ruta que el wake-word -- el
# modelo es el .onnx oficial de Silero VAD (snakers4/silero-vad), copiado
# tal cual como asset propio (no se agregó el paquete pip `silero-vad` como
# dependencia -- arrastra `torch`/`torchaudio` con reglas de versión propias
# que pisaron el torch nightly con CUDA del proyecto la primera vez que se
# probó; se corre directo con onnxruntime, igual que el wake-word).
def resolve_vad_model_path():
    candidates = []
    if hasattr(sys, "_MEIPASS"):
        candidates.append(os.path.join(sys._MEIPASS, "vad", "silero_vad.onnx"))
    if getattr(sys, "frozen", False):
        candidates.append(os.path.join(os.path.dirname(sys.executable), "vad", "silero_vad.onnx"))
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "vad", "silero_vad.onnx"))

    for p in candidates:
        if os.path.isfile(p):
            return p
    return candidates[0] if candidates else "vad/silero_vad.onnx"


WAKE_WORD_MODEL_PATH = resolve_wake_word_model_path()
WAKE_WORD_THRESHOLD = 0.85
WAKE_WORD_SAMPLE_RATE = 16000
WAKE_WORD_FRAME_SAMPLES = 1280  # 80ms a 16kHz, mismo tamaño de frame que usa nanowakeword
WAKE_WORD_COOLDOWN_S = 3.0

# El frontend hace polling de este contador (ver /wake-word/poll) -- se
# incrementa cada vez que se detecta "Hey Miku", en vez de un evento push,
# porque voice_server.py es un proceso separado del backend de Tauri (mismo
# patrón de polling que ya usa useVoiceServer.ts para saber cuándo el
# servidor está listo).
wake_word_state_lock = threading.Lock()
wake_word_detection_id = 0
wake_word_enabled = True

# Tarea 8.1: VAD (Voice Activity Detection) con Silero VAD -- corre en el
# MISMO hilo/stream de audio que el wake-word de arriba (sounddevice sigue
# abierto de punta a punta, ver _wake_word_loop): wake_word_enabled y
# vad_enabled son modos MUTUAMENTE EXCLUYENTES del mismo audio_callback,
# nunca los dos a la vez -- el frontend prende uno u otro según qué está
# pasando (escuchando "Hey Miku" en silencio, vs. grabando/Miku hablando).
#
# Dos usos distintos del mismo "¿hay voz humana ahora?":
# 1. Auto-stop de grabación (vad_silence_id): tras detectar voz sostenida,
#    un silencio sostenido después indica que terminó de hablar -- ver
#    useVoiceActivityDetection.ts, reemplaza soltar el botón manualmente.
# 2. Barge-in (vad_speech_started_id): voz sostenida detectada mientras
#    Miku está hablando dispara la interrupción -- ver useBargeIn.ts.
#
# Umbral y milisegundos sin calibrar contra uso real todavía -- ajustar acá
# primero si en la práctica se siente muy sensible (corta con pausas
# normales de respiración) o muy lento (tarda en reaccionar).
VAD_MODEL_PATH = resolve_vad_model_path()
VAD_SAMPLE_RATE = 16000
VAD_WINDOW_SAMPLES = 512  # calibración oficial de Silero VAD a 16kHz (32ms)
VAD_THRESHOLD = 0.5
# Histéresis (mismo criterio que get_speech_timestamps_from_probs en el
# propio código fuente de silero-vad -- neg_threshold = threshold - 0.15):
# un umbral MÁS BAJO para decidir "¿de verdad se calló?" que el que se usa
# para "¿arrancó a hablar?". Sin esto (primera versión, un solo umbral para
# las dos cosas), un bache normal de volumen a mitad de frase -- que baja
# de 0.5 sin ser silencio real -- se contaba como silencio y cortaba la
# grabación antes de tiempo en una pausa corta (bug real reportado por
# Sebastián en la primera prueba en vivo).
VAD_NEG_THRESHOLD = 0.35
VAD_SPEECH_CONFIRM_WINDOWS = 3  # ~96ms de voz sostenida antes de contar "empezó a hablar" -- mismo criterio que confirmation_frames del wake-word de Android (§6.41 del contexto), evita que un ruido corto dispare algo
VAD_SILENCE_MS = 1200  # silencio sostenido tras haber hablado para contar "terminó de hablar" -- subido de 900 a 1200 (más margen para pausas normales), a recalibrar con más uso

vad_state_lock = threading.Lock()
vad_enabled = False
vad_speech_started_id = 0  # se incrementa al confirmar el arranque de una voz sostenida (barge-in)
vad_silence_id = 0  # se incrementa al confirmar el final de un tramo de voz (auto-stop)


VAD_CONTEXT_SAMPLES = 64  # ver el comentario largo en _SileroVad.push()

class _SileroVad:
    """Envoltorio chico sobre el .onnx oficial de Silero VAD -- stateful
    (arrastra el tensor `state` entre llamadas, como pide el modelo), con
    un buffer propio para juntar los frames de 80ms que entrega
    audio_callback en ventanas de 512 muestras (32ms), que es con lo que
    Silero está calibrado a 16kHz.

    Detalle no documentado en el modelo en sí (encontrado leyendo el código
    fuente real de `OnnxWrapper` en el paquete `silero-vad`, no la
    documentación): el input de cada ventana no son 512 muestras solas --
    hay que pegarle ADELANTE las últimas 64 muestras de la ventana
    anterior ("contexto"), quedando 576 muestras reales por llamada. Sin
    esto el modelo devuelve probabilidades cercanas a cero siempre, sin
    importar el audio (bug real encontrado en la primera prueba de este
    wrapper, con voz sintética real de Edge-TTS que debería haber dado
    probabilidad alta y daba ~0.002 -- ver test_vad_with_real_speech.py)."""

    def __init__(self, model_path: str):
        self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.reset()

    def reset(self):
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, VAD_CONTEXT_SAMPLES), dtype=np.float32)
        self._buffer = np.zeros((0,), dtype=np.float32)

    def push(self, frame_int16: np.ndarray):
        """Agrega un frame nuevo (int16) y devuelve la probabilidad de voz
        de cada ventana de 512 muestras que se haya podido completar (0, 1
        o más, según cuánto haya sobrado del frame anterior)."""
        chunk = frame_int16.astype(np.float32) / 32768.0
        self._buffer = np.concatenate([self._buffer, chunk])

        probs = []
        while len(self._buffer) >= VAD_WINDOW_SAMPLES:
            window = self._buffer[:VAD_WINDOW_SAMPLES]
            self._buffer = self._buffer[VAD_WINDOW_SAMPLES:]

            model_input = np.concatenate([self._context, window.reshape(1, -1)], axis=1)

            out, self._state = self.session.run(
                None,
                {
                    "input": model_input,
                    "state": self._state,
                    "sr": np.array(VAD_SAMPLE_RATE, dtype=np.int64),
                },
            )
            self._context = model_input[:, -VAD_CONTEXT_SAMPLES:]
            probs.append(float(out[0][0]))
        return probs


_vad = None  # se instancia junto con el wake-word, ver _wake_word_loop
_vad_consec_speech = 0
_vad_consec_silence = 0
_vad_speech_confirmed = False
_vad_last_speech_at = 0.0


def _process_vad_frame(frame_int16):
    global vad_speech_started_id, vad_silence_id
    global _vad_consec_speech, _vad_consec_silence, _vad_speech_confirmed, _vad_last_speech_at

    if _vad is None:
        return

    for prob in _vad.push(frame_int16):
        now = time_module.monotonic()
        # Histéresis: una vez confirmada la voz, hace falta caer por debajo
        # del umbral MÁS BAJO (VAD_NEG_THRESHOLD) para contar como
        # silencio -- ver el comentario largo junto a VAD_NEG_THRESHOLD.
        # Para detectar el ARRANQUE de la voz (todavía no confirmada) se
        # sigue usando el umbral normal.
        threshold_now = VAD_NEG_THRESHOLD if _vad_speech_confirmed else VAD_THRESHOLD
        is_speech = prob >= threshold_now

        if is_speech:
            _vad_consec_speech += 1
            _vad_consec_silence = 0
            _vad_last_speech_at = now
            if not _vad_speech_confirmed and _vad_consec_speech >= VAD_SPEECH_CONFIRM_WINDOWS:
                _vad_speech_confirmed = True
                with vad_state_lock:
                    vad_speech_started_id += 1
        else:
            _vad_consec_silence += 1
            _vad_consec_speech = 0
            if _vad_speech_confirmed:
                silence_ms = (now - _vad_last_speech_at) * 1000
                if silence_ms >= VAD_SILENCE_MS:
                    _vad_speech_confirmed = False
                    with vad_state_lock:
                        vad_silence_id += 1


def _vad_set_enabled(enabled: bool):
    """Reinicia el estado de la sesión (buffer, tensor RNN, contadores de
    voz/silencio consecutivos) cada vez que se prende -- para que una
    sesión nueva (grabar de nuevo, o que Miku vuelva a hablar) no arrastre
    nada de la sesión anterior."""
    global vad_enabled, _vad_consec_speech, _vad_consec_silence, _vad_speech_confirmed
    vad_enabled = enabled
    if enabled:
        _vad_consec_speech = 0
        _vad_consec_silence = 0
        _vad_speech_confirmed = False
        if _vad is not None:
            _vad.reset()


def _wake_word_loop():
    global wake_word_detection_id, _vad

    if not os.path.isfile(WAKE_WORD_MODEL_PATH):
        print(f"[WAKE_WORD][ERROR] No se encontró el modelo en: {WAKE_WORD_MODEL_PATH}")
        return

    try:
        interpreter = NanoInterpreter.load_model(WAKE_WORD_MODEL_PATH)
    except Exception:
        print("[WAKE_WORD][ERROR] Fallo al cargar el modelo de wake word:")
        traceback.print_exc()
        return

    try:
        _vad = _SileroVad(VAD_MODEL_PATH)
        print(f"[VAD] Modelo cargado (modelo: {VAD_MODEL_PATH})")
    except Exception:
        print("[VAD][ERROR] Fallo al cargar el modelo de VAD -- queda desactivado, sin cortar el arranque del wake-word:")
        traceback.print_exc()
        _vad = None

    last_trigger_at = 0.0

    def audio_callback(indata, _frames, _time_info, status):
        nonlocal last_trigger_at
        global wake_word_detection_id

        if status:
            print(f"[WAKE_WORD][WARN] Estado del stream de audio: {status}")

        frame = indata[:, 0]

        # Modos mutuamente excluyentes del mismo stream -- ver el comentario
        # largo arriba de vad_state_lock.
        if vad_enabled:
            _process_vad_frame(frame)
            return

        if not wake_word_enabled:
            return

        try:
            result = interpreter.predict(frame)
        except Exception:
            print("[WAKE_WORD][ERROR] Fallo al predecir:")
            traceback.print_exc()
            return

        if result.score >= WAKE_WORD_THRESHOLD:
            now = time_module.monotonic()
            if now - last_trigger_at >= WAKE_WORD_COOLDOWN_S:
                last_trigger_at = now
                with wake_word_state_lock:
                    wake_word_detection_id += 1
                print(f"[WAKE_WORD] Detectado 'Hey Miku' (score={result.score:.3f})")
                # El score interno queda "pegado" arriba varios segundos
                # después de detectar (filtro de patience/debounce de
                # nanowakeword, pensado para no cortar a mitad de frase).
                # Se resetea acá para no arrastrar ese estado durante el
                # cooldown ni interferir con la próxima detección real.
                interpreter.reset()

    try:
        with sd.InputStream(
            samplerate=WAKE_WORD_SAMPLE_RATE,
            channels=1,
            dtype="int16",
            blocksize=WAKE_WORD_FRAME_SAMPLES,
            callback=audio_callback,
        ):
            print(f"[WAKE_WORD] Escuchando 'Hey Miku' (modelo: {WAKE_WORD_MODEL_PATH})")
            while True:
                time_module.sleep(1)
    except Exception:
        print("[WAKE_WORD][ERROR] Fallo al abrir el micrófono:")
        traceback.print_exc()

print(f"[INFO] Directorio de trabajo establecido en: {os.getcwd()}")
print(f"[INFO] Rhubarb resuelto en: {RHUBARB_PATH} (Existe: {os.path.isfile(RHUBARB_PATH)})")
print("[INFO] Inicializando servidor de voz e instanciando RVC...")

# La voz base de Edge TTS (antes de RVC). La usa TTS_RVC y también
# tts_with_text_lipsync, que llama a Edge directo para tener los tiempos
# de cada palabra.
TTS_VOICE = "es-MX-DaliaNeural"

try:
    tts = TTS_RVC(
        model_path="C:/Users/sebas/MikuAI-Project/Miku-RVC/model.pth",
        voice=TTS_VOICE,
    )
    print("[OK] Modelo de voz RVC cargado correctamente.")
except Exception as e:
    print("[ERROR CRÍTICO] Fallo al cargar el modelo RVC:")
    traceback.print_exc()

# Carpeta propia para cachear el modelo Whisper (se descarga solo la primera vez)
WHISPER_CACHE_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "MikuAI", "whisper-cache"
)
os.makedirs(WHISPER_CACHE_DIR, exist_ok=True)

print("[INFO] Cargando modelo Whisper (large-v3-turbo)... puede tardar en el primer arranque si se descarga.")
try:
    whisper_model = WhisperModel(
        "large-v3-turbo",
        device="cuda",
        compute_type="float16",
        download_root=WHISPER_CACHE_DIR,
    )
    print("[OK] Modelo Whisper cargado correctamente.")
except Exception as e:
    whisper_model = None
    print("[ERROR CRÍTICO] Fallo al cargar el modelo Whisper:")
    traceback.print_exc()


def get_visemes(wav_path, dialog_text):
    dialog_path = wav_path.replace(".wav", "_dialog.txt")
    with open(dialog_path, "w", encoding="utf-8") as f:
        f.write(dialog_text)

    json_path = wav_path.replace(".wav", "_visemes.json")

    subprocess.run(
        [
            RHUBARB_PATH,
            "-f", "json",
            "-o", json_path,
            "-r", "phonetic",
            "--dialogFile", dialog_path,
            wav_path,
        ],
        check=True,
    )

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    return data.get("mouthCues", [])

async def _edge_tts_with_words(text, tts_rate, out_path):
    # Mismos parámetros que usa TTS_RVC por dentro (tts_communicate), más
    # boundary="WordBoundary": en la MISMA llamada llegan los tiempos de
    # cada palabra, sin costo extra.
    communicate = edge_tts.Communicate(
        text,
        TTS_VOICE,
        rate=f'{"+" if tts_rate >= 0 else ""}{tts_rate}%',
        boundary="WordBoundary",
    )
    words = []
    with open(out_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append((chunk["offset"] / 1e7, chunk["duration"] / 1e7, chunk["text"]))
    return words


def tts_with_text_lipsync(text, pitch, tts_rate):
    """Voz + boca desde el texto (ver lipsync_text.py). None si no se pudo.

    RVC no cambia los tiempos del audio (solo el timbre), así que los
    tiempos de palabra de Edge valen igual para la voz final de Miku.
    """
    mp3_path = os.path.join(tempfile.gettempdir(), f"miku_tts_{time_module.time_ns()}.mp3")
    try:
        words = asyncio.run(_edge_tts_with_words(text, tts_rate, mp3_path))
        # voiceover_file devuelve None si RVC está ocupado con otro pedido.
        wav_path = tts.voiceover_file(mp3_path, pitch=pitch, index_rate=0.75)
        if not wav_path:
            return None
        with wave.open(wav_path, "rb") as w:
            duration = w.getnframes() / w.getframerate()
        return wav_path, visemes_from_words(words, duration)
    except Exception:
        print("[WARN] Voz con boca desde el texto falló, se usa el camino con Rhubarb:")
        traceback.print_exc()
        return None
    finally:
        try:
            os.remove(mp3_path)
        except OSError:
            pass


@app.route("/speak", methods=["POST"])
def speak():
    try:
        data = request.get_json() or {}
        text = data.get("text", "")
        pitch = data.get("pitch", 10)
        tts_rate = data.get("tts_rate", 15)
        # "texto" (boca desde el texto, ~1 s más rápido) o "rhubarb" (el de
        # siempre). Interruptor en Config del frontend para compararlos.
        lipsync = data.get("lipsync", "rhubarb")

        if not text:
            return {"error": "No se proporcionó texto"}, 400

        text_for_speech = text.replace(". ", ", ").replace(".", ",")

        result = tts_with_text_lipsync(text_for_speech, pitch, tts_rate) if lipsync == "texto" else None
        if result:
            generated_wav, visemes = result
        else:
            generated_wav = tts(
                text=text_for_speech,
                pitch=pitch,
                index_rate=0.75,
                tts_rate=tts_rate,
            )

            try:
                visemes = get_visemes(generated_wav, text_for_speech)
            except Exception:
                print("[WARN] Rhubarb falló, continuando sin visemas:")
                traceback.print_exc()
                visemes = []

        with open(generated_wav, "rb") as f:
            audio_base64 = base64.b64encode(f.read()).decode("utf-8")

        return jsonify({
            "audio": audio_base64,
            "visemes": visemes,
        })
    except Exception as e:
        print("[ERROR EN /speak]:")
        traceback.print_exc()
        return {"error": str(e)}, 500


@app.route("/transcribe", methods=["POST"])
def transcribe():
    try:
        if whisper_model is None:
            return {"error": "El modelo Whisper no está disponible"}, 503

        audio_bytes = request.get_data()
        if not audio_bytes:
            return {"error": "No se recibió audio"}, 400

        # vad_filter=True: faster-whisper trae su propio VAD (Silero,
        # embebido) para descartar tramos sin voz ANTES de transcribir --
        # sin esto, Whisper alucina frases fijas de su entrenamiento sobre
        # audio silencioso/casi silencioso (clásico "gracias por ver el
        # video", típico de subtítulos de YouTube) -- bug real reportado
        # por Sebastián: la primera palabra al prender el mic siempre era
        # "gracias", incluso con el micrófono muteado de verdad.
        segments, _info = whisper_model.transcribe(
            io.BytesIO(audio_bytes),
            language="es",
            vad_filter=True,
        )
        text = "".join(segment.text for segment in segments).strip()

        return jsonify({"text": text})
    except Exception as e:
        print("[ERROR EN /transcribe]:")
        traceback.print_exc()
        return {"error": str(e)}, 500


@app.route("/transcribe/partial", methods=["POST"])
def transcribe_partial():
    # Tarea 5.4b: transcripción incremental. Reusa el mismo Whisper ya
    # cargado -- no hay motor nuevo, ver §6.26 del contexto para por qué se
    # descartaron Voxtral Realtime (VRAM) y Parakeet TDT (el export a ONNX
    # todavía no soporta streaming real). La técnica es "LocalAgreement"
    # simplificada: el frontend manda el audio acumulado desde que empezó a
    # grabar, cada vez más largo, y esta ruta lo retranscribe entero cada
    # vez -- el resultado reemplaza al anterior en el cuadro de texto,
    # hasta que /transcribe (al soltar el botón) lo reemplaza con la
    # versión final de mejor calidad.
    #
    # beam_size=1 (greedy) en vez del default (beam_size=5): prioriza
    # velocidad sobre precisión perfecta, porque este resultado es
    # descartable -- se llama varias veces por segundo de grabación.
    # condition_on_previous_text=False: evita que un audio parcial corto o
    # ambiguo entre en loop repitiendo texto.
    try:
        if whisper_model is None:
            return {"error": "El modelo Whisper no está disponible"}, 503

        audio_bytes = request.get_data()
        if not audio_bytes:
            return {"error": "No se recibió audio"}, 400

        segments, _info = whisper_model.transcribe(
            io.BytesIO(audio_bytes),
            language="es",
            beam_size=1,
            condition_on_previous_text=False,
            vad_filter=True,  # mismo motivo que en /transcribe -- ver el comentario largo ahí
        )
        text = "".join(segment.text for segment in segments).strip()

        return jsonify({"text": text})
    except Exception as e:
        print("[ERROR EN /transcribe/partial]:")
        traceback.print_exc()
        return {"error": str(e)}, 500


@app.route("/wake-word/poll", methods=["GET"])
def wake_word_poll():
    with wake_word_state_lock:
        return jsonify({"detectionId": wake_word_detection_id})


@app.route("/wake-word/enabled", methods=["POST"])
def wake_word_set_enabled():
    global wake_word_enabled
    data = request.get_json() or {}
    wake_word_enabled = bool(data.get("enabled", True))
    return jsonify({"enabled": wake_word_enabled})


@app.route("/vad/poll", methods=["GET"])
def vad_poll():
    # Tarea 8.1: mismo patrón de polling que /wake-word/poll -- dos
    # contadores independientes, uno por cada uso (ver el comentario largo
    # junto a vad_state_lock).
    with vad_state_lock:
        return jsonify({
            "speechStartId": vad_speech_started_id,
            "silenceId": vad_silence_id,
        })


@app.route("/vad/enabled", methods=["POST"])
def vad_set_enabled_route():
    data = request.get_json() or {}
    _vad_set_enabled(bool(data.get("enabled", False)))
    return jsonify({"enabled": vad_enabled})


# Tarea 8.11: embeddings para la memoria semántica -- solo se buscan por
# similitud las memorias "de agente" (conocimiento.md); las memorias de
# Miku (memories.md) se siguen cargando completas, ver lib/knowledge.ts en
# el frontend.
#
# Modelo: intfloat/multilingual-e5-small (MIT), versión cuantizada ONNX de
# su repo oficial en Hugging Face (onnx/model_qint8_avx512_vnni.onnx +
# onnx/tokenizer.json), guardada en embeddings/ -- no está en git (118 MB,
# GitHub no acepta archivos de más de 100 MB); viaja dentro del .exe como
# rhubarb/. Corre en CPU con onnxruntime + tokenizers, que ya estaban por
# faster-whisper: sin torch ni paquetes nuevos (ver lo que pasó con el pip
# de silero-vad en la Tarea 8.1). ~20 ms por lote de textos cortos.
#
# e5 exige prefijos: "query: " para la búsqueda y "passage: " para lo que
# se indexa -- sin eso la calidad cae.
def resolve_embeddings_dir():
    candidates = []
    if hasattr(sys, "_MEIPASS"):
        candidates.append(os.path.join(sys._MEIPASS, "embeddings"))
    if getattr(sys, "frozen", False):
        candidates.append(os.path.join(os.path.dirname(sys.executable), "embeddings"))
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "embeddings"))

    for p in candidates:
        if os.path.isfile(os.path.join(p, "tokenizer.json")):
            return p
    return candidates[0]


EMBEDDINGS_DIR = resolve_embeddings_dir()
_embedder_lock = threading.Lock()
_embedder = None


def _get_embedder():
    # Carga perezosa (~0.6 s) en el primer uso, no al arrancar: no suma
    # nada al tiempo de arranque del servidor de voz.
    global _embedder
    with _embedder_lock:
        if _embedder is None:
            from tokenizers import Tokenizer

            session = ort.InferenceSession(
                os.path.join(EMBEDDINGS_DIR, "multilingual-e5-small-qint8.onnx"),
                providers=["CPUExecutionProvider"],
            )
            tokenizer = Tokenizer.from_file(os.path.join(EMBEDDINGS_DIR, "tokenizer.json"))
            tokenizer.enable_truncation(512)
            tokenizer.enable_padding()
            _embedder = (session, tokenizer)
        return _embedder


def _embed(texts):
    session, tokenizer = _get_embedder()
    encodings = tokenizer.encode_batch(texts)
    ids = np.array([e.ids for e in encodings], dtype=np.int64)
    mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
    hidden = session.run(
        None,
        {"input_ids": ids, "attention_mask": mask, "token_type_ids": np.zeros_like(ids)},
    )[0]
    # Mean pooling con la máscara de atención + normalización L2 (así lo
    # define e5), para que la similitud sea un simple producto punto.
    mask_f = mask[..., None].astype(np.float32)
    vectors = (hidden * mask_f).sum(axis=1) / np.maximum(mask_f.sum(axis=1), 1e-9)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors


@app.route("/embed", methods=["POST"])
def embed_route():
    data = request.get_json() or {}
    texts = data.get("texts") or []
    kind = data.get("kind", "passage")
    if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
        return jsonify({"error": "texts debe ser una lista de strings"}), 400
    if kind not in ("query", "passage"):
        return jsonify({"error": "kind debe ser 'query' o 'passage'"}), 400
    if not texts:
        return jsonify({"vectors": []})
    try:
        vectors = _embed([f"{kind}: {t}" for t in texts])
        return jsonify({"vectors": np.round(vectors, 5).tolist()})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Error generando embeddings: {e}"}), 500


@app.route("/shutdown", methods=["POST", "GET"])
def shutdown():
    def do_exit():
        import time
        time.sleep(0.3)
        os._exit(0)
    import threading
    threading.Thread(target=do_exit, daemon=True).start()
    return jsonify({"status": "shutting down"})


def start_parent_watchdog():
    """Vigila si el proceso padre finaliza para no quedar huérfano."""
    def watchdog():
        try:
            parent_pid = os.getppid()
            if not parent_pid or parent_pid <= 1:
                return

            import ctypes
            SYNCHRONIZE = 0x00100000
            INFINITE = 0xFFFFFFFF
            handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, parent_pid)
            if handle:
                ctypes.windll.kernel32.WaitForSingleObject(handle, INFINITE)
                ctypes.windll.kernel32.CloseHandle(handle)
                print(f"[WATCHDOG] Proceso padre (PID {parent_pid}) finalizó. Terminando voice_server...")
                os._exit(0)
        except Exception:
            pass

    import threading
    t = threading.Thread(target=watchdog, daemon=True)
    t.start()


if __name__ == "__main__":
    start_parent_watchdog()
    threading.Thread(target=_wake_word_loop, daemon=True).start()
    print("[INFO] Servidor listo. Escuchando en http://127.0.0.1:8899")
    serve(app, host="127.0.0.1", port=8899)