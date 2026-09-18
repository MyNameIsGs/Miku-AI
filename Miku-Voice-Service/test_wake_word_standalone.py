import os
import time

import sounddevice as sd
from nanowakeword import NanoInterpreter

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wake_word", "hey_miku_v1.onnx")
THRESHOLD = 0.85
SAMPLE_RATE = 16000
FRAME_SAMPLES = 1280
COOLDOWN_S = 3.0

print(f"Cargando modelo desde: {MODEL_PATH}")
interpreter = NanoInterpreter.load_model(MODEL_PATH)
print("Modelo cargado. Escuchando 'Hey Miku' (Ctrl+C para salir)...")

last_trigger_at = 0.0


def callback(indata, frames, time_info, status):
    global last_trigger_at
    if status:
        print(f"[WARN] {status}")
    frame = indata[:, 0]
    result = interpreter.predict(frame)
    peak = int(abs(frame).max())
    marker = " <<<< DETECTADO" if result.score >= THRESHOLD else ""
    print(f"score={result.score:.3f}  peak={peak}{marker}")
    if result.score >= THRESHOLD:
        now = time.monotonic()
        if now - last_trigger_at >= COOLDOWN_S:
            last_trigger_at = now
            interpreter.reset()


with sd.InputStream(
    samplerate=SAMPLE_RATE,
    channels=1,
    dtype="int16",
    blocksize=FRAME_SAMPLES,
    callback=callback,
):
    while True:
        time.sleep(1)
