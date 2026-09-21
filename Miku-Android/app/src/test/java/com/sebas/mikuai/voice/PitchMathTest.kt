package com.sebas.mikuai.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class PitchMathTest {

    @Test
    fun toCoarse_matchesPythonReference() {
        // Pares (f0_hz -> f0_coarse) calculados a mano con la misma fórmula
        // que `pipeline.py` (f0_min=50, f0_max=1100), ver conversación de diseño.
        val cases = mapOf(
            0.0 to 1,
            30.0 to 1,
            50.0 to 1,
            100.0 to 20,
            220.0 to 60,
            440.0 to 122,
            880.0 to 217,
            1100.0 to 255,
            1500.0 to 255,
        )
        for ((f0, expected) in cases) {
            assertEquals("f0=$f0", expected, PitchMath.toCoarse(f0))
        }
    }

    @Test
    fun decode_allZeroSalience_isUnvoiced() {
        val salience = arrayOf(FloatArray(360) { 0f })
        val (pitch, nsff0) = PitchMath.decode(salience)
        assertEquals(1, pitch[0])
        assertEquals(0f, nsff0[0], 0f)
    }

    @Test
    fun decode_singleSpike_matchesExpectedFrequency() {
        // Un único bin activo (200) -> el promedio ponderado ±4 devuelve
        // exactamente cents_mapping[200] (nada más pesa), luego f0 = 10*2^(cents/1200)
        // y se transpone *2^(10/12) (F0_UP_KEY=10 fijo). Ver cálculo de referencia.
        val salience = FloatArray(360)
        salience[200] = 1.0f
        val (pitch, nsff0) = PitchMath.decode(arrayOf(salience))

        val expectedF0 = 569.3127509025137
        assertEquals(expectedF0, nsff0[0].toDouble(), expectedF0 * 0.001)
        assertEquals(PitchMath.toCoarse(expectedF0), pitch[0])
    }

    @Test
    fun decode_belowThreshold_isUnvoiced() {
        val salience = FloatArray(360)
        salience[100] = 0.02f // < THRESHOLD (0.03)
        val (pitch, nsff0) = PitchMath.decode(arrayOf(salience))
        assertEquals(1, pitch[0])
        assertEquals(0f, nsff0[0], 0f)
    }
}
