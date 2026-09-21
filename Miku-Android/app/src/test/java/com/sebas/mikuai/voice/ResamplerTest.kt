package com.sebas.mikuai.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin
import kotlin.math.sqrt

class ResamplerTest {

    @Test
    fun resample_sameRate_returnsCopy() {
        val input = FloatArray(100) { it.toFloat() }
        val out = Resampler.resample(input, 16000, 16000)
        assertEquals(input.size, out.size)
        assertEquals(input[50], out[50], 1e-6f)
    }

    @Test
    fun resample_24kTo16k_producesExpectedLength() {
        val durationSec = 1.0
        val input = FloatArray((24000 * durationSec).toInt())
        val out = Resampler.resample(input, 24000, 16000)
        val expectedLen = (input.size.toLong() * 16000 / 24000).toInt()
        assertEquals(expectedLen, out.size)
    }

    @Test
    fun resample_sineWave_preservesAmplitude() {
        // 440Hz a 24kHz, 0.5s -- bien por debajo del Nyquist de destino (8kHz),
        // así que la amplitud (RMS) debería preservarse casi exacta tras
        // resamplear a 16kHz (sin aliasing, sin atenuación de banda pasante).
        val freq = 440.0
        val fromRate = 24000
        val toRate = 16000
        val n = (fromRate * 0.5).toInt()
        val input = FloatArray(n) { i -> sin(2.0 * PI * freq * i / fromRate).toFloat() }

        val out = Resampler.resample(input, fromRate, toRate)

        // Ignorar los bordes (transitorio del filtro) al medir RMS.
        val margin = 200
        fun rms(a: FloatArray, from: Int, to: Int): Double {
            var sum = 0.0
            for (i in from until to) sum += a[i].toDouble() * a[i]
            return sqrt(sum / (to - from))
        }
        val inputRms = rms(input, margin, input.size - margin)
        val outputRms = rms(out, margin, out.size - margin)

        assertTrue(
            "inputRms=$inputRms outputRms=$outputRms",
            kotlin.math.abs(inputRms - outputRms) < inputRms * 0.05
        )
    }
}
