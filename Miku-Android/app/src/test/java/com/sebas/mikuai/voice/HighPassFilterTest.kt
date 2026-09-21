package com.sebas.mikuai.voice

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin
import kotlin.math.sqrt

class HighPassFilterTest {

    private fun rms(a: FloatArray, from: Int, to: Int): Double {
        var sum = 0.0
        for (i in from until to) sum += a[i].toDouble() * a[i]
        return sqrt(sum / (to - from))
    }

    @Test
    fun apply_attenuatesLowFrequency() {
        val sr = 16000
        val n = sr * 2
        // 10Hz, muy por debajo del corte (48Hz) -- debería quedar casi eliminada.
        val lowFreq = FloatArray(n) { i -> sin(2.0 * PI * 10.0 * i / sr).toFloat() }
        val out = HighPassFilter.apply(lowFreq, sr)

        val margin = 2000 // dejar asentar el filtro
        val inRms = rms(lowFreq, margin, n - margin)
        val outRms = rms(out, margin, n - margin)
        assertTrue("inRms=$inRms outRms=$outRms", outRms < inRms * 0.2)
    }

    @Test
    fun apply_preservesHighFrequency() {
        val sr = 16000
        val n = sr * 2
        // 1kHz, muy por encima del corte -- debería pasar casi sin atenuar.
        val highFreq = FloatArray(n) { i -> sin(2.0 * PI * 1000.0 * i / sr).toFloat() }
        val out = HighPassFilter.apply(highFreq, sr)

        val margin = 2000
        val inRms = rms(highFreq, margin, n - margin)
        val outRms = rms(out, margin, n - margin)
        assertTrue("inRms=$inRms outRms=$outRms", outRms > inRms * 0.9)
    }
}
