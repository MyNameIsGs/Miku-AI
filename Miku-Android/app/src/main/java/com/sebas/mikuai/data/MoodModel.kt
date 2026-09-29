package com.sebas.mikuai.data

import kotlin.math.max
import kotlin.math.pow

/**
 * Modelo del ánimo de Miku, el mismo que lib/moodModel.ts de desktop (mismas
 * constantes: los dos lados calculan igual sobre el mismo archivo
 * compartido, ver SharedMood.kt). Un nivel 0-100 que cada cosa empuja, que
 * se va apagando solo, y cuya duración depende de lo que lo causó; cuánto la
 * afecta algo y cuánto le dura lo decide ella en [ESTADO_ANIMO].
 *
 * En el celular solo la mueve la charla (no hay tacto): no hace falta el
 * historial de acostumbrarse/hartarse de desktop.
 */
object MoodModel {
    val MOODS = listOf("happy", "angry", "sad", "relaxed", "neutral")

    private val AMOUNT_POINTS = mapOf("poco" to 15.0, "bastante" to 35.0, "mucho" to 60.0)
    private val DURATION_HALF_LIFE_MS = mapOf(
        "un_rato" to 20 * 60 * 1000L,
        "unas_horas" to 3 * 60 * 60 * 1000L,
        "todo_el_dia" to 10 * 60 * 60 * 1000L,
    )
    val AMOUNTS = AMOUNT_POINTS.keys.toList()
    val DURATIONS = DURATION_HALF_LIFE_MS.keys.toList()

    const val NEUTRAL_BELOW = 12.0
    const val FACE_FROM = 30.0
    const val STRONG_FROM = 65.0

    data class State(val mood: String, val intensity: Double, val halfLifeMs: Long, val setAt: Long)

    val NEUTRAL = State("neutral", 0.0, DURATION_HALF_LIFE_MS.getValue("un_rato"), 0)

    fun currentIntensity(state: State, now: Long): Double {
        if (state.mood == "neutral") return 0.0
        val elapsed = max(0L, now - state.setAt)
        return state.intensity * 0.5.pow(elapsed.toDouble() / state.halfLifeMs)
    }

    fun currentMood(state: State, now: Long): String =
        if (currentIntensity(state, now) >= NEUTRAL_BELOW) state.mood else "neutral"

    /** Empuja el ánimo. Sin cuánto/dura: los de la charla (bastante, unas horas). */
    fun applyPush(state: State, mood: String, amount: String?, duration: String?, now: Long): State {
        val points = AMOUNT_POINTS[amount] ?: AMOUNT_POINTS.getValue("bastante")
        val halfLife = DURATION_HALF_LIFE_MS[duration] ?: DURATION_HALF_LIFE_MS.getValue("unas_horas")
        val current = currentIntensity(state, now)
        return when {
            // Calmarse: baja lo que haya.
            mood == "neutral" -> {
                val left = max(0.0, current - points)
                state.copy(intensity = left, setAt = now, mood = if (left > 0) state.mood else "neutral")
            }
            // El mismo ánimo (o venía de neutral): sube, cada vez con menos margen.
            state.mood == mood || current < NEUTRAL_BELOW -> {
                val base = if (state.mood == mood) current else 0.0
                State(mood, base + points * (1 - base / 100), max(halfLife, if (state.mood == mood) state.halfLifeMs else 0L), now)
            }
            // Otro ánimo: primero baja el que tiene; si sobra empuje, cambia.
            else -> {
                val left = current - points
                if (left >= 0) state.copy(intensity = left, setAt = now) else State(mood, -left, halfLife, now)
            }
        }
    }

    private val ADJ = mapOf("happy" to "contenta", "angry" to "enojada", "sad" to "triste", "relaxed" to "relajada")

    /** "un poco contenta", "contenta", "muy contenta" o "neutral". */
    fun describe(state: State, now: Long): String {
        val i = currentIntensity(state, now)
        if (state.mood == "neutral" || i < NEUTRAL_BELOW) return "neutral"
        val adj = ADJ[state.mood] ?: return "neutral"
        return when {
            i < FACE_FROM -> "un poco $adj"
            i < STRONG_FROM -> adj
            else -> "muy $adj"
        }
    }
}
