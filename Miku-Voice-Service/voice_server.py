import os
import sys
import shutil
import tempfile
import traceback
import unicodedata  # Forzar importación previa
import subprocess
import json
import base64

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

from flask import Flask, request, jsonify
from flask_cors import CORS
from tts_with_rvc import TTS_RVC
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
    print("[INFO] Servidor listo. Escuchando en http://127.0.0.1:8899")
    serve(app, host="127.0.0.1", port=8899)