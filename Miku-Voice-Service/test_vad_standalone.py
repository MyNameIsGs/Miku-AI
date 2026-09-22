"""Script suelto para validar la integración de Silero VAD antes de que
corra dentro de voice_server.py -- mismo criterio que
test_wake_word_standalone.py (Tarea 5.4): probar la pieza aislada antes de
confiar en que el pipeline completo la usa bien.

IMPORTANTE -- qué prueba esto y qué NO: sin micrófono real en este entorno,
no se puede generar audio de voz humana de verdad para verificar que el
modelo la reconoce como tal (un tono senoidal o ruido blanco sintético le
dan probabilidad ~0 -- correcto, Silero está entrenado para reconocer las
características espectrales de la voz humana, no "cualquier energía").
Lo que SÍ valida este script es que la integración en sí (formas de los
tensores, tipos de dato, que el estado se propague entre llamadas) no está
rota -- entradas distintas dan salidas distintas, sin excepciones. La
calibración real de VAD_THRESHOLD/VAD_SILENCE_MS necesita audio real
(hablar de verdad frente al micrófono), igual que el umbral del wake-word
en su momento -- eso queda para cuando Sebastián lo pruebe en vivo.
"""
import numpy as np
import onnxruntime as ort

MODEL_PATH = "vad/silero_vad.onnx"
SAMPLE_RATE = 16000
WINDOW_SAMPLES = 512

CONTEXT_SAMPLES = 64  # ver el comentario largo en _SileroVad de voice_server.py -- sin esto el modelo da ~0 siempre, sin importar el audio (bug real, encontrado con test_vad_with_real_speech.py)

session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
print("Modelo cargado. Inputs:", [i.name for i in session.get_inputs()])

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


rng = np.random.default_rng(0)
silence_probs = [run_window(np.zeros(WINDOW_SAMPLES, dtype=np.float32)) for _ in range(10)]

state = np.zeros((2, 1, 128), dtype=np.float32)  # reset entre casos, como haría _vad_set_enabled
context = np.zeros((1, CONTEXT_SAMPLES), dtype=np.float32)
noise_probs = [
    run_window(rng.uniform(-0.8, 0.8, WINDOW_SAMPLES).astype(np.float32)) for _ in range(10)
]

print(f"Silencio -- prob. promedio: {np.mean(silence_probs):.4f}, rango: [{min(silence_probs):.4f}, {max(silence_probs):.4f}]")
print(f"Ruido    -- prob. promedio: {np.mean(noise_probs):.4f}, rango: [{min(noise_probs):.4f}, {max(noise_probs):.4f}]")

for label, probs in [("silencio", silence_probs), ("ruido", noise_probs)]:
    for p in probs:
        assert 0.0 <= p <= 1.0, f"Probabilidad fuera de rango [0,1] en caso '{label}': {p}"

assert len(set(silence_probs)) > 1 or len(set(noise_probs)) > 1, (
    "El modelo devolvió exactamente el mismo valor siempre -- probable bug de integración "
    "(el estado no se está propagando, o las entradas no le están llegando de verdad)."
)

print("OK: la integración corre sin errores, formas/tipos correctos, el estado se propaga.")
print("Pendiente: calibrar VAD_THRESHOLD/VAD_SILENCE_MS con voz real (voice_server.py).")
