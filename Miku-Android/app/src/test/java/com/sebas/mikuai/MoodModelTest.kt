package com.sebas.mikuai

import com.sebas.mikuai.data.MoodModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// Mismos casos que moodModel.test.ts de desktop: los dos lados tienen que
// calcular igual sobre el mismo archivo compartido.
class MoodModelTest {
    private val min = 60_000L

    @Test
    fun charlaBastanteLaDejaContenta() {
        val s = MoodModel.applyPush(MoodModel.NEUTRAL, "happy", null, null, 0)
        assertEquals("contenta", MoodModel.describe(s, 0))
    }

    @Test
    fun poquitoEsUnPoco() {
        val s = MoodModel.applyPush(MoodModel.NEUTRAL, "happy", "poco", "un_rato", 0)
        assertEquals("un poco contenta", MoodModel.describe(s, 0))
    }

    @Test
    fun loPasajeroSeApagaEnMenosDeUnaHora() {
        val s = MoodModel.applyPush(MoodModel.NEUTRAL, "happy", "bastante", "un_rato", 0)
        assertEquals("neutral", MoodModel.describe(s, 60 * min))
    }

    @Test
    fun algoTristeEstandoContentaPrimeroBajaLaAlegria() {
        val happy = MoodModel.applyPush(MoodModel.NEUTRAL, "happy", "bastante", "unas_horas", 0)
        val after = MoodModel.applyPush(happy, "sad", "poco", "unas_horas", 0)
        assertEquals("happy", after.mood)
        assertTrue(MoodModel.currentIntensity(after, 0) < MoodModel.currentIntensity(happy, 0))
    }

    @Test
    fun muchoYTodoElDiaEsMuyYDura() {
        val s = MoodModel.applyPush(MoodModel.applyPush(MoodModel.NEUTRAL, "happy", "mucho", "todo_el_dia", 0), "happy", "mucho", "todo_el_dia", 60 * min)
        assertEquals("muy contenta", MoodModel.describe(s, 60 * min))
        assertTrue(MoodModel.describe(s, 6 * 60 * min) != "neutral")
    }
}
