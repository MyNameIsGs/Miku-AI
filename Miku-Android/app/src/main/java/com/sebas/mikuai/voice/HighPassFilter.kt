package com.sebas.mikuai.voice

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Filtro pasa-altos biquad (RBJ audio EQ cookbook), usado para replicar el
 * primer paso del pipeline real de RVC: `filtfilt(bh, ah, audio)` en
 * `vc/pipeline.py` (Butterworth orden 5, 48Hz, zero-phase).
 *
 * Simplificación deliberada: acá se aplica un único biquad de 2do orden en
 * un solo pasada (no zero-phase) en vez de reproducir el filtro de orden 5
 * de scipy -- a un corte tan bajo (48Hz) sobre voz, el desfasaje que
 * introduce un solo pasada es imperceptible. Si algún día hace falta más
 * fidelidad, aplicar esta misma función dos veces (adelante y atrás sobre
 * el array invertido) aproxima el comportamiento zero-phase de `filtfilt`.
 */
object HighPassFilter {

    /** Aplica un pasa-altos Butterworth (Q=0.707) de corte [cutoffHz] sobre [signal] a [sampleRate] Hz. */
    fun apply(signal: FloatArray, sampleRate: Int, cutoffHz: Double = 48.0, q: Double = 0.70710678): FloatArray {
        if (signal.isEmpty()) return signal.copyOf()

        val w0 = 2.0 * PI * cutoffHz / sampleRate
        val alpha = sin(w0) / (2.0 * q)
        val cosW0 = cos(w0)

        var b0 = (1.0 + cosW0) / 2.0
        var b1 = -(1.0 + cosW0)
        var b2 = (1.0 + cosW0) / 2.0
        val a0 = 1.0 + alpha
        var a1 = -2.0 * cosW0
        var a2 = 1.0 - alpha

        b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0

        val out = FloatArray(signal.size)
        var x1 = 0.0
        var x2 = 0.0
        var y1 = 0.0
        var y2 = 0.0
        for (i in signal.indices) {
            val x0 = signal[i].toDouble()
            val y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            out[i] = y0.toFloat()
            x2 = x1; x1 = x0
            y2 = y1; y1 = y0
        }
        return out
    }
}
