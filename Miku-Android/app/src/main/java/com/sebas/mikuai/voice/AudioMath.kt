package com.sebas.mikuai.voice

/**
 * Utilidades numéricas chicas compartidas por el pipeline de voz RVC, sin
 * equivalente directo en la librería estándar de Kotlin/Android.
 */
object AudioMath {

    /**
     * Padding "reflect" (igual a `numpy.pad(mode="reflect")`, sin repetir la
     * muestra del borde) -- usado antes de generar (`t_pad`, ver `pipeline.py`)
     * y en el cálculo de RMS centrado.
     *
     * Asume `padAmount < signal.size` (siempre cierto en este pipeline: los
     * enunciados de TTS duran varios segundos, `padAmount` es 1s a 16kHz o
     * medio frame de RMS).
     */
    fun reflectPad(signal: FloatArray, padAmount: Int): FloatArray {
        if (padAmount <= 0 || signal.isEmpty()) return signal.copyOf()
        val n = signal.size
        val out = FloatArray(n + 2 * padAmount)
        System.arraycopy(signal, 0, out, padAmount, n)
        for (i in 0 until padAmount) {
            out[padAmount - 1 - i] = signal[(i + 1).coerceAtMost(n - 1)]
            out[padAmount + n + i] = signal[(n - 2 - i).coerceAtLeast(0)]
        }
        return out
    }

    /** Peak-normalize: si el pico supera [ceiling], escala todo el array para que quede justo en el techo. */
    fun peakNormalize(signal: FloatArray, ceiling: Double): FloatArray {
        var peak = 0.0
        for (v in signal) {
            val a = kotlin.math.abs(v.toDouble())
            if (a > peak) peak = a
        }
        val audioMax = peak / ceiling
        if (audioMax <= 1.0) return signal.copyOf()
        val scale = 1.0 / audioMax
        return FloatArray(signal.size) { (signal[it] * scale).toFloat() }
    }
}
