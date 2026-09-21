package com.sebas.mikuai.voice

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sqrt

class RmsMixerTest {

    @Test
    fun mix_constantAmplitudes_convergesToGeometricMean() {
        // Con rate=0.5 fijo, la ganancia aplicada es sqrt(rms_source/rms_converted),
        // así que para dos señales de amplitud constante A1/A2 el resultado
        // esperado es una señal de amplitud ~sqrt(A1*A2) (media geométrica).
        val a1 = 0.2f
        val a2 = 0.8f
        val sourceRate = 16000
        val convertedRate = 48000

        val source = FloatArray(sourceRate * 2) { a1 } // 2s @ 16kHz
        val converted = FloatArray(convertedRate * 2) { a2 } // 2s @ 48kHz

        val mixed = RmsMixer.mix(source, sourceRate, converted, convertedRate)

        val expected = sqrt(a1.toDouble() * a2.toDouble())
        val mid = mixed.size / 2
        assertTrue(
            "expected=$expected actual=${mixed[mid]}",
            kotlin.math.abs(mixed[mid] - expected) < expected * 0.05
        )
    }

    @Test
    fun mix_emptyConverted_returnsEmpty() {
        val out = RmsMixer.mix(FloatArray(1000), 16000, FloatArray(0), 48000)
        assertTrue(out.isEmpty())
    }
}
