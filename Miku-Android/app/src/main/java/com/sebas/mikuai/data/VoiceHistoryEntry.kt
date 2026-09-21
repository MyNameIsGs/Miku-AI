package com.sebas.mikuai.data

import org.json.JSONArray
import org.json.JSONObject

// Idea #10 de la lista: las conversaciones por "Hey Miku" no quedaban
// guardadas en ningún lado que ChatScreen pudiera mostrar después --
// WakeWordService no tiene acceso al ChatViewModel (viven en procesos/
// ciclos de vida distintos), así que la única forma de que sobrevivan es
// un archivo propio, sincronizado por GitHub -- mismo patrón que
// pendientes.json, pero sin campos de estado/fecha porque acá no hace
// falta: es un log simple, no algo que se "cierre".
data class VoiceHistoryEntry(
    val heard: String,
    val reply: String,
    val timestampMs: Long,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("heard", heard)
        put("reply", reply)
        put("timestampMs", timestampMs)
    }

    companion object {
        fun fromJson(obj: JSONObject): VoiceHistoryEntry = VoiceHistoryEntry(
            heard = obj.getString("heard"),
            reply = obj.getString("reply"),
            timestampMs = obj.getLong("timestampMs"),
        )
    }
}

fun parseVoiceHistoryJson(raw: String): List<VoiceHistoryEntry> {
    if (raw.isBlank()) return emptyList()
    val array = JSONArray(raw)
    return (0 until array.length()).map { VoiceHistoryEntry.fromJson(array.getJSONObject(it)) }
}

fun serializeVoiceHistory(entries: List<VoiceHistoryEntry>): String {
    val array = JSONArray()
    entries.forEach { array.put(it.toJson()) }
    return array.toString(2)
}
