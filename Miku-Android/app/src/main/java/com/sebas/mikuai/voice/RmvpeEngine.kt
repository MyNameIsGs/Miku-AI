package com.sebas.mikuai.voice

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.providers.NNAPIFlags
import java.io.File
import java.nio.FloatBuffer
import java.util.EnumSet

/**
 * Estimador de pitch RMVPE (`melspectrogram_fp32.onnx` + `rmvpe_int8.onnx`)
 * -- puerto de `RMVPE.infer_from_audio`/`mel2hidden` en `infer/lib/rmvpe.py`.
 * Devuelve el salience crudo `[n_frames][360]`; la decodificación a f0/pitch
 * coarse vive en [PitchMath], puro Kotlin y testeable aparte.
 */
class RmvpeEngine(melModelPath: File, rmvpeModelPath: File) {

    private val env = OrtEnvironment.getEnvironment()
    private val opts = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(2)
        setInterOpNumThreads(1)
        // NNAPI experimental, ver el comentario largo en RvcGeneratorEngine.kt.
        try {
            addNnapi(EnumSet.noneOf(NNAPIFlags::class.java))
        } catch (e: Exception) {
        }
    }
    private val melSession: OrtSession = env.createSession(melModelPath.absolutePath, opts)
    private val rmvpeSession: OrtSession = env.createSession(rmvpeModelPath.absolutePath, opts)

    fun close() {
        melSession.close()
        rmvpeSession.close()
    }

    /** Salience crudo de RMVPE para [audio16k] (mono, 16kHz, float32, ya paddeado). */
    fun salience(audio16k: FloatArray): Array<FloatArray> {
        val mel = computeMel(audio16k) // [128][T_mel]
        val nFrames = mel[0].size
        val nPad = 32 * ((nFrames - 1) / 32 + 1) - nFrames // RMVPE necesita un múltiplo de 32 frames (U-Net de 5 niveles)
        val melForModel = if (nPad > 0) padMelFrames(mel, nPad) else mel
        val salienceFull = runRmvpe(melForModel)
        return if (nPad > 0) salienceFull.copyOfRange(0, nFrames) else salienceFull
    }

    private fun computeMel(audio16k: FloatArray): Array<FloatArray> {
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(audio16k), longArrayOf(1, audio16k.size.toLong()))
        return inputTensor.use { input ->
            melSession.run(mapOf("audio" to input)).use { result ->
                val output = result[0] as OnnxTensor
                val shape = output.info.shape // [1, 128, T_mel]
                val nMel = shape[1].toInt()
                val t = shape[2].toInt()
                val flat = output.floatBuffer
                Array(nMel) { m -> FloatArray(t) { ti -> flat.get(m * t + ti) } }
            }
        }
    }

    private fun padMelFrames(mel: Array<FloatArray>, nPad: Int): Array<FloatArray> {
        val t = mel[0].size
        return Array(mel.size) { m ->
            FloatArray(t + nPad) { ti -> if (ti < t) mel[m][ti] else 0f }
        }
    }

    private fun runRmvpe(mel: Array<FloatArray>): Array<FloatArray> {
        val nMel = mel.size
        val t = mel[0].size
        val flat = FloatArray(nMel * t)
        for (m in 0 until nMel) {
            for (ti in 0 until t) flat[m * t + ti] = mel[m][ti]
        }
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(flat), longArrayOf(1, nMel.toLong(), t.toLong()))
        return inputTensor.use { input ->
            rmvpeSession.run(mapOf("input" to input)).use { result ->
                val output = result[0] as OnnxTensor
                val shape = output.info.shape // [1, n_frames, 360]
                val frames = shape[1].toInt()
                val bins = shape[2].toInt()
                val flatOut = output.floatBuffer
                Array(frames) { f -> FloatArray(bins) { b -> flatOut.get(f * bins + b) } }
            }
        }
    }
}
