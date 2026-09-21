package com.sebas.mikuai.voice

import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Decodificación de pitch a partir de la salida "salience" de RMVPE, puerto
 * exacto de `RMVPE.to_local_average_cents`/`decode` y del binning coarse de
 * `Pipeline.get_f0` (`infer/lib/rmvpe.py` y `vc/pipeline.py` del lado Python).
 * Puro Kotlin, sin ONNX ni Android -- pensado para poder testearse con
 * JUnit sin depender de un teléfono.
 *
 * `F0_UP_KEY = 10` es fijo (no configurable por el usuario): es la
 * transposición que ya usa producción para la voz de Miku (`pitch=10` en
 * `voice_server.py`).
 */
object PitchMath {

    private const val NUM_BINS = 360
    private const val THRESHOLD = 0.03
    private const val F0_UP_KEY = 10

    private const val F0_MIN = 50.0
    private const val F0_MAX = 1100.0
    private val F0_MEL_MIN = 1127.0 * ln(1.0 + F0_MIN / 700.0)
    private val F0_MEL_MAX = 1127.0 * ln(1.0 + F0_MAX / 700.0)

    /** cents_mapping[i] = 20*i + 1997.3794084376191, i en 0..359 (rmvpe.py). */
    private val centsMapping = DoubleArray(NUM_BINS) { i -> 20.0 * i + 1997.3794084376191 }

    /**
     * Decodifica la salida cruda de RMVPE (`[n_frames][360]`, salience/sigmoid)
     * a `pitch` (bins coarse 1..255, para el generador) y `nsff0` (Hz continuos).
     */
    fun decode(salience: Array<FloatArray>): Pair<IntArray, FloatArray> {
        val n = salience.size
        val pitchCoarse = IntArray(n)
        val nsff0 = FloatArray(n)
        for (i in 0 until n) {
            val cents = decodeFrameCents(salience[i])
            var f0 = 10.0 * 2.0.pow(cents / 1200.0)
            if (f0 == 10.0) f0 = 0.0 // cents==0 -> no sonoro
            f0 *= 2.0.pow(F0_UP_KEY / 12.0) // transposición fija (+10 semitonos)
            nsff0[i] = f0.toFloat()
            pitchCoarse[i] = toCoarse(f0)
        }
        return pitchCoarse to nsff0
    }

    /** Promedio ponderado por salience de cents_mapping en una ventana de ±4 bins alrededor del argmax. */
    private fun decodeFrameCents(salience: FloatArray): Double {
        var argmax = 0
        var maxVal = salience[0]
        for (i in 1 until salience.size) {
            if (salience[i] > maxVal) {
                maxVal = salience[i]
                argmax = i
            }
        }
        if (maxVal <= THRESHOLD) return 0.0

        var weightedSum = 0.0
        var weightTotal = 0.0
        for (offset in -4..4) {
            val idx = argmax + offset
            if (idx in 0 until NUM_BINS) {
                val s = salience[idx].toDouble()
                weightedSum += s * centsMapping[idx]
                weightTotal += s
            }
        }
        return if (weightTotal > 0.0) weightedSum / weightTotal else 0.0
    }

    /** Binning mel-scale de f0 (Hz) a un entero coarse en [1,255] -- exacto a `pipeline.py`. */
    fun toCoarse(f0: Double): Int {
        val rawMel = if (f0 <= 0.0) 0.0 else 1127.0 * ln(1.0 + f0 / 700.0)
        var mel = if (rawMel > 0.0) {
            (rawMel - F0_MEL_MIN) * 254.0 / (F0_MEL_MAX - F0_MEL_MIN) + 1.0
        } else {
            rawMel
        }
        if (mel <= 1.0) mel = 1.0
        if (mel > 255.0) mel = 255.0
        return mel.roundToInt()
    }
}
