package com.sebas.mikuai.voice

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.providers.NNAPIFlags
import java.io.File
import java.nio.FloatBuffer
import java.util.EnumSet

/**
 * Codificador de contenido HuBERT (`hubert_fp32.onnx`) -- puerto del punto
 * de `HubertModel.extract_features()` en `vc/pipeline.py`. Se queda en FP32
 * a propósito: la versión int8 sonaba con "susurros de fondo" (confirmado
 * al oído), ver el plan.
 *
 * Sin `padding_mask` como input: producción confirmó que pasar `None` es
 * numéricamente idéntico a un tensor todo-False (nunca hay batching acá),
 * y el export a ONNX ya lo asume así.
 */
class HubertEngine(modelPath: File) {

    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession = env.createSession(
        modelPath.absolutePath,
        OrtSession.SessionOptions().apply {
            // 6 hilos (no 4): mismo criterio que RvcGeneratorEngine.kt --
            // último ajuste barato de hilos antes de aceptar la latencia
            // actual (ver conversación sobre la demora de la voz real).
            setIntraOpNumThreads(6)
            setInterOpNumThreads(1)
            // NNAPI experimental, ver el comentario largo en RvcGeneratorEngine.kt.
            try {
                addNnapi(EnumSet.noneOf(NNAPIFlags::class.java))
            } catch (e: Exception) {
            }
        }
    )

    fun close() = session.close()

    /**
     * Corre HuBERT sobre [audio16k] (mono, 16kHz, float32, ya paddeado) y
     * devuelve las features de contenido tras el upsample x2 que hace
     * producción antes de pasarlas al generador (`F.interpolate(..., scale_factor=2)`
     * SIN mode explícito -> default "nearest", o sea duplicar cada frame,
     * NO interpolación lineal) -- shape resultante `[T*2][768]`.
     */
    fun extractFeatures(audio16k: FloatArray): Array<FloatArray> {
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(audio16k), longArrayOf(1, audio16k.size.toLong()))
        val raw = inputTensor.use { input ->
            session.run(mapOf("source" to input)).use { result ->
                val output = result[0] as OnnxTensor
                val shape = output.info.shape // [1, T, 768]
                val t = shape[1].toInt()
                val c = shape[2].toInt()
                val flat = output.floatBuffer
                Array(t) { ti -> FloatArray(c) { ci -> flat.get(ti * c + ci) } }
            }
        }
        return upsampleNearest2x(raw)
    }

    /** Duplica cada frame (upsample "nearest" x2, igual al default de `F.interpolate` en producción). */
    private fun upsampleNearest2x(features: Array<FloatArray>): Array<FloatArray> {
        val t = features.size
        val out = Array(t * 2) { FloatArray(0) }
        for (i in 0 until t) {
            out[2 * i] = features[i]
            out[2 * i + 1] = features[i]
        }
        return out
    }
}
