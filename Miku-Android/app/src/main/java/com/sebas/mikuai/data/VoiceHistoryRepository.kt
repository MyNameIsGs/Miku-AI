package com.sebas.mikuai.data

private const val VOICE_HISTORY_PATH = "Miku-AI/memory/voice_history.json"

// Tope de entradas guardadas -- es un log de "qué le pediste por voz", no un
// historial completo sin límite. Cada entrada son 2 mensajes (heard+reply)
// al prepender en ChatViewModel, así que 15 entradas son 30 mensajes, bien
// por debajo del tope de 40 que ya usa el chat de texto.
private const val MAX_ENTRIES = 15

/**
 * Log de las conversaciones por "Hey Miku" (idea #10), sincronizado por
 * GitHub -- mismo mecanismo que [PendientesRepository], mismo criterio de
 * manejo de 404 (el archivo puede no existir todavía) y de reintento ante
 * un SHA obsoleto.
 */
class VoiceHistoryRepository(private val ghApi: GitHubApi) {

    suspend fun load(): List<VoiceHistoryEntry> {
        return try {
            parseVoiceHistoryJson(ghApi.getFile(VOICE_HISTORY_PATH).content)
        } catch (e: Exception) {
            emptyList()
        }
    }

    suspend fun append(heard: String, reply: String) {
        val entry = VoiceHistoryEntry(heard, reply, System.currentTimeMillis())
        writeWithRetry { current -> (current + entry).takeLast(MAX_ENTRIES) }
    }

    private suspend fun writeWithRetry(transform: (List<VoiceHistoryEntry>) -> List<VoiceHistoryEntry>) {
        val (currentContent, currentSha) = try {
            val file = ghApi.getFile(VOICE_HISTORY_PATH)
            file.content to file.sha
        } catch (e: Exception) {
            if (e.message?.contains("404") == true) "[]" to null else throw e
        }

        try {
            ghApi.putFile(
                VOICE_HISTORY_PATH,
                serializeVoiceHistory(transform(parseVoiceHistoryJson(currentContent))),
                currentSha,
                "memory: voice_history.json (android)",
            )
        } catch (e: Exception) {
            if (e.message?.contains("409") == true || e.message?.contains("422") == true) {
                val fresh = ghApi.getFile(VOICE_HISTORY_PATH)
                ghApi.putFile(
                    VOICE_HISTORY_PATH,
                    serializeVoiceHistory(transform(parseVoiceHistoryJson(fresh.content))),
                    fresh.sha,
                    "memory: voice_history.json (android, retry)",
                )
            } else {
                throw e
            }
        }
    }
}
