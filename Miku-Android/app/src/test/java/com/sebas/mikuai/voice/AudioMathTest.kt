package com.sebas.mikuai.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioMathTest {

    @Test
    fun reflectPad_mirrorsWithoutRepeatingEdge() {
        val signal = floatArrayOf(1f, 2f, 3f, 4f, 5f)
        val padded = AudioMath.reflectPad(signal, 2)
        // numpy.pad([1,2,3,4,5], 2, mode="reflect") == [3,2,1,2,3,4,5,4,3,2,1]
        assertEquals(9, padded.size)
        assertEquals(3f, padded[0], 1e-6f)
        assertEquals(2f, padded[1], 1e-6f)
        assertEquals(1f, padded[2], 1e-6f)
        assertEquals(5f, padded[6], 1e-6f)
        assertEquals(4f, padded[7], 1e-6f)
        assertEquals(3f, padded[8], 1e-6f)
    }

    @Test
    fun peakNormalize_scalesDownWhenOverCeiling() {
        val signal = floatArrayOf(-2f, 0f, 2f)
        val out = AudioMath.peakNormalize(signal, 0.99)
        val peak = out.maxOf { kotlin.math.abs(it) }
        assertTrue(peak <= 1.0f)
        assertEquals(0.99f, peak, 1e-4f)
    }

    @Test
    fun peakNormalize_leavesQuietSignalUnchanged() {
        val signal = floatArrayOf(-0.1f, 0f, 0.1f)
        val out = AudioMath.peakNormalize(signal, 0.99)
        assertEquals(signal[0], out[0], 1e-6f)
        assertEquals(signal[2], out[2], 1e-6f)
    }
}
