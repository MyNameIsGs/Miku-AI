package com.sebas.mikuai.data

import org.json.JSONObject

/**
 * Ánimo compartido con la PC (2026-09-28, "una sola mente"): el mismo
 * Miku-AI/memory/estado_animo.json que usa lib/sharedMood.ts de desktop,
 * por la API de GitHub. Cada escritura lleva el sha leído; si la PC
 * escribió en el medio (409/422), se relee y se vuelve a aplicar sobre lo
 * más nuevo.
 */
class SharedMood(private val gh: GitHubApi) {

    private val path = "Miku-AI/memory/estado_animo.json"

    private fun parse(text: String): MoodModel.State? = try {
        val o = JSONObject(text)
        val mood = o.getString("mood")
        if (mood !in MoodModel.MOODS) null
        else MoodModel.State(mood, o.getDouble("intensity"), o.getLong("halfLifeMs"), o.getLong("setAt"))
    } catch (e: Exception) {
        null
    }

    private suspend fun read(): Pair<MoodModel.State, String?> = try {
        val file = gh.getFile(path)
        (parse(file.content) ?: MoodModel.NEUTRAL) to file.sha
    } catch (e: Exception) {
        // 404: todavía nadie lo creó.
        if (e.message?.contains("404") == true) MoodModel.NEUTRAL to null else throw e
    }

    /** Cómo está ahora, en palabras ("un poco contenta"...), para el prompt. */
    suspend fun describeNow(): String = try {
        MoodModel.describe(read().first, System.currentTimeMillis())
    } catch (e: Exception) {
        "neutral"
    }

    /** Aplica un [ESTADO_ANIMO] de la charla y lo escribe. */
    suspend fun push(mood: String, amount: String?, duration: String?) {
        repeat(3) {
            val (current, sha) = read()
            val now = System.currentTimeMillis()
            val next = MoodModel.applyPush(current, mood, amount, duration, now)
            val json = JSONObject().apply {
                put("mood", next.mood)
                put("intensity", next.intensity)
                put("halfLifeMs", next.halfLifeMs)
                put("setAt", next.setAt)
                put("device", "celular")
            }.toString(2)
            try {
                gh.putFile(path, json, sha, "memory: ánimo (celular)")
                return
            } catch (e: Exception) {
                val conflict = e.message?.let { it.contains("409") || it.contains("422") } == true
                if (!conflict) throw e
            }
        }
    }
}
