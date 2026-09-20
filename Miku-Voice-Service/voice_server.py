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
import secrets
import socket

from flask import Flask, request, jsonify, abort
from flask_cors import CORS
from nanowakeword import NanoInterpreter
from tts_with_rvc import TTS_RVC
from faster_whisper import WhisperModel
from waitress import serve

app = Flask(__name__)
CORS(app)

# --- Acceso desde la red local (Miku en Android, voz real vía RVC) ---
# Antes el servidor solo respondía en 127.0.0.1 -- nada fuera de la propia
# PC podía alcanzarlo. Para que la app de Android le pida a ESTE MISMO
# servidor que hable con la voz real de Miku (en vez del TTS genérico del
# sistema), tiene que poder llegar por la IP local, así que ahora escucha
# en todas las interfaces (ver el cambio de host en serve(), al final del
# archivo). Para no dejarlo abierto a cualquiera en la misma red Wi-Fi, las
# peticiones que NO vienen de localhost necesitan una clave compartida
# (header X-Miku-Key) -- se genera sola la primera vez y se guarda en
# disco. El panel de Configuración de la app de escritorio la muestra
# (GET /lan-key, que solo responde a localhost) para copiarla una vez a la
# app de Android.
LAN_CONFIG_PATH = os.path.join(
    os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "MikuAI", "lan_config.json"
)


def _load_or_create_lan_key():
    try:
        os.makedirs(os.path.dirname(LAN_CONFIG_PATH), exist_ok=True)
        if os.path.isfile(LAN_CONFIG_PATH):
            with open(LAN_CONFIG_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f).get("lanKey", "")
                if existing:
                    return existing
        new_key = secrets.token_hex(16)
        with open(LAN_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump({"lanKey": new_key}, f)
        return new_key
    except Exception:
        print("[LAN][ERROR] No se pudo leer/crear la clave de acceso de red:")
        traceback.print_exc()
        return secrets.token_hex(16)  # solo para esta sesión, no persiste


LAN_ACCESS_KEY = _load_or_create_lan_key()


def _detect_local_ip():
    """Mejor esfuerzo: no abre ninguna conexión real, solo usa el truco
    de un socket UDP para que el SO resuelva qué interfaz local usaría
    para salir -- estándar para detectar la IP de LAN sin dependencias."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        return None


@app.before_request
def _restrict_lan_access():
    if request.remote_addr in ("127.0.0.1", "::1", None):
        return  # el propio frontend de escritorio -- sin cambio de comportamiento
    if request.headers.get("X-Miku-Key") != LAN_ACCESS_KEY:
        abort(403)


@app.route("/lan-key", methods=["GET"])
def lan_key():
    # El before_request de arriba ya garantiza que esto solo responde a
    # localhost -- es la propia app de escritorio pidiendo la clave para
    # mostrarla en el panel de Configuración, nunca se expone por la red.
    return jsonify({
        "lanKey": LAN_ACCESS_KEY,
        "localIp": _detect_local_ip(),
        "port": 8899,
    })


@app.route("/health", methods=["GET"])
def health():
    # A diferencia de /lan-key (solo localhost), esta SÍ responde a la red
    # local con la clave correcta -- es lo que usa el botón "Probar
    # conexión" de la app de Android para confirmar host+clave sin tener
    # que disparar una síntesis de voz completa solo para probar.
    return jsonify({"ok": True})

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


def _wake_word_loop():
    global wake_word_detection_id

    if not os.path.isfile(WAKE_WORD_MODEL_PATH):
        print(f"[WAKE_WORD][ERROR] No se encontró el modelo en: {WAKE_WORD_MODEL_PATH}")
        return

    try:
        interpreter = NanoInterpreter.load_model(WAKE_WORD_MODEL_PATH)
    except Exception:
        print("[WAKE_WORD][ERROR] Fallo al cargar el modelo de wake word:")
        traceback.print_exc()
        return

    last_trigger_at = 0.0

    def audio_callback(indata, _frames, _time_info, status):
        nonlocal last_trigger_at
        global wake_word_detection_id

        if status:
            print(f"[WAKE_WORD][WARN] Estado del stream de audio: {status}")
        if not wake_word_enabled:
            return

        frame = indata[:, 0]
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

try:
    tts = TTS_RVC(
        model_path="C:/Users/sebas/MikuAI-Project/Miku-RVC/model.pth",
        voice="es-MX-DaliaNeural",
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

@app.route("/speak", methods=["POST"])
def speak():
    try:
        data = request.get_json() or {}
        text = data.get("text", "")
        pitch = data.get("pitch", 10)
        tts_rate = data.get("tts_rate", 15)

        if not text:
            return {"error": "No se proporcionó texto"}, 400

        text_for_speech = text.replace(". ", ", ").replace(".", ",")

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

        segments, _info = whisper_model.transcribe(
            io.BytesIO(audio_bytes),
            language="es",
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
    _local_ip = _detect_local_ip()
    print("[INFO] Servidor listo. Escuchando en http://127.0.0.1:8899")
    if _local_ip:
        print(f"[LAN] También accesible en la red local en http://{_local_ip}:8899 (requiere X-Miku-Key)")
    print(f"[LAN] Clave de acceso de red (para la app de Android): {LAN_ACCESS_KEY}")
    # 0.0.0.0 en vez de 127.0.0.1: necesario para que la app de Android
    # pueda alcanzar este servidor por la IP local (ver bloque de arriba,
    # _restrict_lan_access exige la clave para cualquier origen que no sea
    # localhost).
    serve(app, host="0.0.0.0", port=8899)