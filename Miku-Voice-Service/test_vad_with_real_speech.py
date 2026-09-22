"""Complementa test_vad_standalone.py: en vez de tonos/ruido sintéticos,
genera voz real con Edge-TTS (la misma fuente que usa /speak en
voice_server.py) para validar que el modelo SÍ reconoce habla real como
habla -- un tono senoidal o ruido blanco no alcanzan para eso (ver el
comentario largo en test_vad_standalone.py). No es voz humana grabada por
micrófono, pero acústicamente se parece mucho más que una onda sintética.
"""
import asyncio
import io

import av
import edge_tts
import numpy as np
import onnxruntime as ort

MODEL_PATH = "vad/silero_vad.onnx"
SAMPLE_RATE = 16000
WINDOW_SAMPLES = 512
TEXT = "Hola, esto es una prueba para ver si el modelo reconoce que hay alguien hablando de verdad."


async def synth_to_wav_bytes(text: str) -> bytes:
    communicate = edge_tts.Communicate(text, "es-MX-DaliaNeural")
    chunks = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    return b"".join(chunks)


def mp3_bytes_to_pcm16k(mp3_bytes: bytes) -> np.ndarray:
    # PyAV ya es dependencia del proyecto (faster-whisper lo usa para
    # decodificar), trae su propio ffmpeg embebido -- evita sumar pydub +
    # un binario de ffmpeg en el PATH solo para este script de prueba.
    container = av.open(io.BytesIO(mp3_bytes))
    resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
    pieces = []
    for frame in container.decode(audio=0):
        for rframe in resampler.resample(frame):
            pieces.append(rframe.to_ndarray())
    container.close()
    pcm = np.concatenate(pieces, axis=1).flatten().astype(np.float32) / 32768.0
    return pcm


mp3_bytes = asyncio.run(synth_to_wav_bytes(TEXT))
speech = mp3_bytes_to_pcm16k(mp3_bytes)
print(f"Audio sintetizado: {len(speech) / SAMPLE_RATE:.2f}s")

# Mismo silencio "de verdad" (ceros) antes y después, para comparar los tres tramos.
silence_before = np.zeros(int(SAMPLE_RATE * 1.0), dtype=np.float32)
silence_after = np.zeros(int(SAMPLE_RATE * 1.0), dtype=np.float32)
audio = np.concatenate([silence_before, speech, silence_after])

CONTEXT_SAMPLES = 64  # ver el comentario largo en _SileroVad de voice_server.py

session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
state = np.zeros((2, 1, 128), dtype=np.float32)
context = np.zeros((1, CONTEXT_SAMPLES), dtype=np.float32)


def run_window(window: np.ndarray) -> float:
    global state, context
    model_input = np.concatenate([context, window.reshape(1, -1).astype(np.float32)], axis=1)
    out, state = session.run(
        None,
        {
            "input": model_input,
            "state": state,
            "sr": np.array(SAMPLE_RATE, dtype=np.int64),
        },
    )
    context = model_input[:, -CONTEXT_SAMPLES:]
    return float(out[0][0])


probs = []
for start in range(0, len(audio) - WINDOW_SAMPLES + 1, WINDOW_SAMPLES):
    probs.append(run_window(audio[start:start + WINDOW_SAMPLES]))
probs = np.array(probs)

windows_per_second = SAMPLE_RATE / WINDOW_SAMPLES
silence_before_end = int(1.0 * windows_per_second)
speech_end = int((1.0 + len(speech) / SAMPLE_RATE) * windows_per_second)

avg_silence_before = probs[:silence_before_end].mean()
avg_speech = probs[silence_before_end:speech_end].mean()
avg_silence_after = probs[speech_end:].mean()
above_threshold_ratio = (probs[silence_before_end:speech_end] >= 0.5).mean()

print(f"Prob. promedio silencio antes: {avg_silence_before:.3f}")
print(f"Prob. promedio durante la voz: {avg_speech:.3f} ({above_threshold_ratio * 100:.0f}% de ventanas >= 0.5)")
print(f"Prob. promedio silencio después: {avg_silence_after:.3f}")

assert avg_speech > avg_silence_before, "La voz real debería dar probabilidad más alta que el silencio"
assert avg_speech > avg_silence_after, "La voz real debería dar probabilidad más alta que el silencio"
assert above_threshold_ratio > 0.5, (
    f"Menos de la mitad de las ventanas de voz real superaron VAD_THRESHOLD=0.5 "
    f"({above_threshold_ratio * 100:.0f}%) -- revisar el umbral o la integración."
)
print("OK: el modelo reconoce voz sintética real como voz, y silencio como silencio.")
