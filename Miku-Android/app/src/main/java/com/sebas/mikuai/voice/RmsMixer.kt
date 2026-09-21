package com.sebas.mikuai.voice

import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Mezcla de envolvente de volumen (RMS) entre el audio fuente (16kHz) y el
 * audio ya convertido por el generador (48kHz), puerto de `change_rms` en
 * `infer/vc/pipeline.py`. Con `rate=0.5` (el valor fijo que usa producción,
 * `rms_mix_rate` nunca se pasa distinto desde `voice_server.py`) es un
 * crossfade geométrico de a mitades entre las dos envolventes.
 *
 * Puro Kotlin, sin dependencias de Android -- testeable con señales sintéticas.
 */
object RmsMixer {

    private const val RATE = 0.5

    /**
     * Aplica la mezcla de RMS sobre [converted] (in-place lógicamente, devuelve
     * un array nuevo) usando [source] como referencia de volumen "original".
     */
    fun mix(source: FloatArray, sourceRate: Int, converted: FloatArray, convertedRate: Int): FloatArray {
        if (converted.isEmpty()) return converted.copyOf()

        val rms1 = computeRms(source, frameLength = sourceRate, hopLength = sourceRate / 2)
        val rms2 = computeRms(converted, frameLength = convertedRate, hopLength = convertedRate / 2)

        val n = converted.size
        val r1 = interpolateTo(rms1, n)
        val r2 = interpolateTo(rms2, n)

        val out = FloatArray(n)
        for (i in 0 until n) {
            val g2 = max(r2[i].toDouble(), 1e-6)
            val gain = (r1[i].toDouble() / g2).pow(1.0 - RATE)
            out[i] = (converted[i] * gain).toFloat()
        }
        return out
    }

    /** RMS por ventana centrada (reflect-pad de frameLength/2 a cada lado, como `librosa.feature.rms`). */
    private fun computeRms(signal: FloatArray, frameLength: Int, hopLength: Int): FloatArray {
        if (signal.isEmpty() || frameLength <= 0 || hopLength <= 0) return floatArrayOf(1e-6f)

        val padAmount = frameLength / 2
        val padded = AudioMath.reflectPad(signal, padAmount)

        val numFrames = max(1, 1 + (padded.size - frameLength) / hopLength)
        return FloatArray(numFrames) { f ->
            val start = f * hopLength
            var sumSq = 0.0
            var count = 0
            var i = 0
            while (i < frameLength && start + i < padded.size) {
                val v = padded[start + i]
                sumSq += v * v
                i++
                count++
            }
            if (count > 0) sqrt(sumSq / count).toFloat() else 0f
        }
    }

    /** Interpolación lineal de [curve] a [targetLen] muestras. */
    private fun interpolateTo(curve: FloatArray, targetLen: Int): FloatArray {
        if (targetLen <= 0) return FloatArray(0)
        if (curve.isEmpty()) return FloatArray(targetLen)
        if (curve.size == 1) return FloatArray(targetLen) { curve[0] }

        return FloatArray(targetLen) { i ->
            val pos = i.toDouble() * (curve.size - 1) / max(1, targetLen - 1)
            val lo = pos.toInt().coerceIn(0, curve.size - 1)
            val hi = (lo + 1).coerceAtMost(curve.size - 1)
            val frac = pos - lo
            (curve[lo] * (1 - frac) + curve[hi] * frac).toFloat()
        }
    }
}
