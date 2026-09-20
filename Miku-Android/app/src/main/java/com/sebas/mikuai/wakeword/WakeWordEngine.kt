package com.sebas.mikuai.wakeword

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import java.nio.FloatBuffer
import kotlin.random.Random

/**
 * Puerto a Kotlin/ONNX Runtime Mobile del pipeline de inferencia de
 * `nanowakeword` (ver `NanoInterpreter.predict()` y `AudioFeatures` en
 * Miku-Voice-Service/miku-voice-test/Lib/site-packages/nanowakeword/).
 *
 * Corre los MISMOS tres modelos .onnx que usa el wake-word "Hey Miku" en
 * desktop (melspectrogram + embedding de Google speech_embedding +
 * el clasificador hey_miku_v1 entrenado a medida), en el mismo orden y
 * con el mismo bufferizado streaming -- no es un modelo nuevo, es el
 * mismo modelo corriendo en otra plataforma. Umbral y cooldown viven en
 * WakeWordService (mismos valores que voice_server.py: 0.85 / 3.0s).
 *
 * No es thread-safe: se espera que `processChunk` se llame siempre desde
 * el mismo hilo (el hilo de captura de audio de WakeWordService).
 */
class WakeWordEngine(context: Context) {

    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()

    private val melSession: OrtSession
    private val embSession: OrtSession
    private val clfSession: OrtSession

    /** Frames de embedding (96-dim) que espera el clasificador por inferencia (16, ver §wake_word). */
    private val requiredFrames: Int

    // ---- Estado streaming (equivalente a AudioFeatures + prediction_buffer) ----

    /** Ventana rodante de audio crudo (float, sin normalizar) -- solo se necesitan los últimos ~1760 samples. */
    private var rawBuffer = FloatArray(0)
    private val rawBufferCap = 8000 // ~0.5s a 16kHz, de sobra para la ventana de 1760 que usa el melspec

    /** Buffer de frames de melspectrograma (frames x 32), arranca con 76 filas "de relleno" en 1.0 (igual que AudioFeatures). */
    private var melBuffer: Array<FloatArray> = Array(MEL_WARMUP_FRAMES) { FloatArray(MEL_BINS) { 1.0f } }
    private val melBufferMaxLen = 970 // 10s de historial, igual que AudioFeatures.melspectrogram_max_len

    /** Buffer de embeddings (frames x 96). */
    private var featureBuffer: Array<FloatArray> = arrayOf()
    private val featureBufferMaxLen = 120 // ~10s, igual que AudioFeatures.feature_buffer_max_len

    /** Cuántas veces se llamó a predict() desde el último reset -- los primeros 5 scores se fuerzan a 0 (igual que nanowakeword). */
    private var predictionCount = 0

    init {
        val opts = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(1)
            setInterOpNumThreads(1)
        }
        melSession = env.createSession(readAsset(context, "wakeword/melspectrogram.onnx"), opts)
        embSession = env.createSession(readAsset(context, "wakeword/embedding_model.onnx"), opts)
        clfSession = env.createSession(readAsset(context, "wakeword/hey_miku_v1.onnx"), opts)

        requiredFrames = clfSession.inputInfo.values.first().info.let { info ->
            val shape = (info as ai.onnxruntime.TensorInfo).shape
            // shape = [batch, frames, 96] -> frames es la dim 1
            if (shape.size >= 2 && shape[1] > 0) shape[1].toInt() else 16
        }

        reset()
    }

    /** Reinicia todo el estado interno -- llamar después de cada detección (mismo motivo que `interpreter.reset()` en desktop, ver gotcha §6.20). */
    fun reset() {
        rawBuffer = FloatArray(0)
        melBuffer = Array(MEL_WARMUP_FRAMES) { FloatArray(MEL_BINS) { 1.0f } }
        predictionCount = 0

        // Semilla del feature_buffer con 4s de ruido aleatorio, igual que
        // AudioFeatures.__init__/reset() -- comportamiento heredado de
        // nanowakeword/openWakeWord: los primeros ~16 embeddings reales
        // desplazan esta semilla antes de que importe (y los primeros 5
        // scores ya se fuerzan a 0 de por sí).
        val noise = ShortArray(SEED_NOISE_SAMPLES) { Random.nextInt(-1000, 1000).toShort() }
        val seedMel = computeMelspectrogram(noise.map { it.toFloat() }.toFloatArray())
        featureBuffer = embedWindows(seedMel)
    }

    /**
     * Procesa un chunk de audio de EXACTAMENTE 1280 samples (80ms @ 16kHz,
     * PCM 16-bit mono) y devuelve el score post-procesado (0..1) del
     * clasificador "Hey Miku" para ese instante.
     */
    fun processChunk(samples: ShortArray): Float {
        require(samples.size == FRAME_SAMPLES) { "processChunk espera exactamente $FRAME_SAMPLES samples" }

        // 1. Acumular audio crudo (equivalente a _buffer_raw_data)
        val chunkFloat = FloatArray(samples.size) { samples[it].toFloat() }
        rawBuffer = if (rawBuffer.size + chunkFloat.size > rawBufferCap) {
            (rawBuffer + chunkFloat).copyOfRange(rawBuffer.size + chunkFloat.size - rawBufferCap, rawBuffer.size + chunkFloat.size)
        } else {
            rawBuffer + chunkFloat
        }

        // 2. Melspectrograma de los últimos (n_samples + 160*3) samples (equivalente a _streaming_melspectrogram)
        val windowLen = minOf(rawBuffer.size, FRAME_SAMPLES + 160 * 3)
        val melInput = rawBuffer.copyOfRange(rawBuffer.size - windowLen, rawBuffer.size)
        val newMelFrames = computeMelspectrogram(melInput)

        melBuffer = (melBuffer + newMelFrames).let {
            if (it.size > melBufferMaxLen) it.copyOfRange(it.size - melBufferMaxLen, it.size) else it
        }

        // 3. Un nuevo embedding a partir de las últimas 76 filas del melBuffer (equivalente al loop de _streaming_features
        //    para un chunk fijo de 1280 samples, donde siempre se agrega exactamente 1 fila nueva por llamada).
        if (melBuffer.size >= MEL_WARMUP_FRAMES) {
            val window = melBuffer.copyOfRange(melBuffer.size - MEL_WARMUP_FRAMES, melBuffer.size)
            val newEmbedding = embedWindows(window) // shape (1, 96)
            featureBuffer = (featureBuffer + newEmbedding).let {
                if (it.size > featureBufferMaxLen) it.copyOfRange(it.size - featureBufferMaxLen, it.size) else it
            }
        }

        // 4. Clasificar si ya hay suficiente historial de features
        if (featureBuffer.size < requiredFrames) {
            return 0f
        }

        val features = featureBuffer.copyOfRange(featureBuffer.size - requiredFrames, featureBuffer.size)
        var score = classify(features)

        // Los primeros 5 scores desde el último reset se fuerzan a 0 -- estabilidad de arranque, igual que nanowakeword.
        if (predictionCount < 5) {
            score = 0f
        }
        predictionCount++

        return score
    }

    fun close() {
        melSession.close()
        embSession.close()
        clfSession.close()
    }

    // ---- Modelos ONNX individuales ----

    /** spec = melspec_model(x); return spec/10 + 2 -- mismo transform que AudioFeatures._get_melspectrogram. */
    private fun computeMelspectrogram(samples: FloatArray): Array<FloatArray> {
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(samples), longArrayOf(1, samples.size.toLong()))
        inputTensor.use { input ->
            melSession.run(mapOf("input" to input)).use { result ->
                val output = result[0] as OnnxTensor
                val shape = output.info.shape // (1, 1, frames, 32) en la práctica
                val frames = shape[shape.size - 2].toInt()
                val bins = shape[shape.size - 1].toInt()
                val flat = output.floatBuffer
                return Array(frames) { f ->
                    FloatArray(bins) { b -> flat.get(f * bins + b) / 10f + 2f }
                }
            }
        }
    }

    /** embedding_model(melspec windows) -- una fila de 96 floats por ventana de 76 frames de entrada. */
    private fun embedWindows(mel: Array<FloatArray>): Array<FloatArray> {
        if (mel.size < MEL_WARMUP_FRAMES) return arrayOf()

        val windows = mutableListOf<Array<FloatArray>>()
        var i = 0
        while (i < mel.size) {
            if (i + MEL_WARMUP_FRAMES <= mel.size) {
                windows.add(mel.copyOfRange(i, i + MEL_WARMUP_FRAMES))
            }
            i += 8
        }
        if (windows.isEmpty()) return arrayOf()

        val batch = windows.size
        val flat = FloatArray(batch * MEL_WARMUP_FRAMES * MEL_BINS)
        var idx = 0
        for (w in windows) {
            for (frame in w) {
                for (v in frame) {
                    flat[idx++] = v
                }
            }
        }

        val inputTensor = OnnxTensor.createTensor(
            env, FloatBuffer.wrap(flat),
            longArrayOf(batch.toLong(), MEL_WARMUP_FRAMES.toLong(), MEL_BINS.toLong(), 1)
        )
        inputTensor.use { input ->
            embSession.run(mapOf("input_1" to input)).use { result ->
                val output = result[0] as OnnxTensor
                val flatOut = output.floatBuffer
                return Array(batch) { b ->
                    FloatArray(EMBEDDING_DIM) { d -> flatOut.get(b * EMBEDDING_DIM + d) }
                }
            }
        }
    }

    private fun classify(features: Array<FloatArray>): Float {
        val flat = FloatArray(features.size * EMBEDDING_DIM)
        var idx = 0
        for (row in features) {
            for (v in row) flat[idx++] = v
        }
        val inputTensor = OnnxTensor.createTensor(
            env, FloatBuffer.wrap(flat),
            longArrayOf(1, features.size.toLong(), EMBEDDING_DIM.toLong())
        )
        inputTensor.use { input ->
            clfSession.run(mapOf("input" to input)).use { result ->
                val output = result[0] as OnnxTensor
                return output.floatBuffer.get(0)
            }
        }
    }

    companion object {
        const val FRAME_SAMPLES = 1280
        private const val MEL_BINS = 32
        private const val MEL_WARMUP_FRAMES = 76
        private const val EMBEDDING_DIM = 96
        private const val SEED_NOISE_SAMPLES = 16000 * 4 // 4s @ 16kHz, igual que AudioFeatures.__init__

        private fun readAsset(context: Context, path: String): ByteArray =
            context.assets.open(path).use { it.readBytes() }
    }
}
