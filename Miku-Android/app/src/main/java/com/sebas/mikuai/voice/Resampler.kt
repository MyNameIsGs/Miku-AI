package com.sebas.mikuai.voice

import kotlin.math.PI
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Resampler de audio puro Kotlin (sin dependencias de Android), usado para
 * pasar el MP3 de Edge-TTS (24kHz) al 16kHz que esperan HuBERT/RMVPE (ver
 * `load_audio(input_audio_path, 16000)` en `vc/modules.py` del lado Python).
 *
 * Interpolación lineal NO alcanza la calidad necesaria acá (genera aliasing
 * audible), así que se implementa un resampler racional L/M con un filtro
 * sinc con ventana Kaiser -- el mismo enfoque que usa `scipy.signal.resample_poly`
 * (diseño de filtro: cutoff normalizado a 1/max(L,M), largo 2*10*max(L,M)+1).
 */
object Resampler {

    /** Reamplea [input] de [fromRate] Hz a [toRate] Hz. Devuelve un nuevo FloatArray. */
    fun resample(input: FloatArray, fromRate: Int, toRate: Int): FloatArray {
        if (fromRate == toRate || input.isEmpty()) return input.copyOf()

        val g = gcd(fromRate, toRate)
        val l = toRate / g
        val m = fromRate / g
        val maxLm = max(l, m)

        val halfLen = 10 * maxLm
        val filterLen = 2 * halfLen + 1
        val delay = halfLen.toDouble()
        val window = kaiserWindow(filterLen, KAISER_BETA)

        // h[n] = L * (1/maxLm) * sinc((n-delay)/maxLm) * window[n]
        // (sinc normalizado: sinc(0)=1, sinc(x)=sin(pi*x)/(pi*x) en otro caso)
        val h = DoubleArray(filterLen) { n ->
            val x = (n - delay) / maxLm
            val sincVal = if (x == 0.0) 1.0 else sin(PI * x) / (PI * x)
            l * (1.0 / maxLm) * sincVal * window[n]
        }

        val outputLen = (input.size.toLong() * l / m).toInt()
        val output = FloatArray(outputLen)
        for (n in 0 until outputLen) {
            var acc = 0.0
            val center = n * m
            var k = 0
            while (k < filterLen) {
                val idx = center - k
                if (idx < 0) break
                if (idx % l == 0) {
                    val inputIdx = idx / l
                    if (inputIdx < input.size) {
                        acc += h[k] * input[inputIdx]
                    }
                }
                k++
            }
            output[n] = acc.toFloat()
        }
        return output
    }

    private fun gcd(a: Int, b: Int): Int {
        var x = a
        var y = b
        while (y != 0) {
            val t = y
            y = x % y
            x = t
        }
        return x
    }

    /** Función de Bessel modificada de primera especie, orden 0 -- serie de potencias (converge rápido para beta~8). */
    private fun besselI0(x: Double): Double {
        var sum = 1.0
        var term = 1.0
        var k = 1
        while (term > sum * 1e-12) {
            term *= (x * x / 4.0) / (k * k)
            sum += term
            k++
        }
        return sum
    }

    private fun kaiserWindow(length: Int, beta: Double): DoubleArray {
        val alpha = (length - 1) / 2.0
        val i0Beta = besselI0(beta)
        return DoubleArray(length) { n ->
            val ratio = (n - alpha) / alpha
            besselI0(beta * sqrt(max(0.0, 1.0 - ratio * ratio))) / i0Beta
        }
    }

    private const val KAISER_BETA = 8.6
}
