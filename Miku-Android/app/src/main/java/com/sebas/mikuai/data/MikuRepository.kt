package com.sebas.mikuai.data

import android.content.Context
import java.time.LocalDate

class MikuRepository(ghToken: String, orKey: String, context: Context, prefs: SecurePrefs) {

    private val ghApi = GitHubApi(ghToken)
    private val orApi = OpenRouterApi(orKey)
    private val pendientesRepo = PendientesRepository(ghApi)
    private val voiceHistoryRepo = VoiceHistoryRepository(ghApi)
    private val spotifyAuth = SpotifyAuth(context, prefs)
    private val spotifyApi = SpotifyApi(spotifyAuth)
    private val gmailAuth = GmailAuth(context, prefs)
    private val gmailApi = GmailApi(gmailAuth)
    private val calendarAuth = CalendarAuth(context, prefs)
    private val calendarApi = CalendarApi(calendarAuth)

    suspend fun loadMemory(): MikuMemory {
        return MikuMemory(
            world       = ghApi.getFile("Miku-AI/memory/world.md"),
            personality = ghApi.getFile("Miku-AI/memory/personality.md"),
            memories    = ghApi.getFile("Miku-AI/memory/memories.md")
        )
    }

    suspend fun appendToFile(
        memory: MikuMemory,
        key: String,
        text: String
    ): GitHubFile {
        val path    = "Miku-AI/memory/$key.md"
        val date    = LocalDate.now().toString()
        val current = when (key) {
            "personality" -> memory.personality
            "memories"    -> memory.memories
            else          -> throw IllegalArgumentException("Archivo desconocido: $key")
        }
        val newContent = current.content.trimEnd() + "\n" + text.trim() + "\n"

        return try {
            val newSha = ghApi.putFile(path, newContent, current.sha, "memory: append $key.md [$date]")
            GitHubFile(content = newContent, sha = newSha)
        } catch (e: Exception) {
            // SHA obsoleto: re-fetch y reintentar
            if (e.message?.contains("409") == true || e.message?.contains("422") == true) {
                val fresh      = ghApi.getFile(path)
                val retryContent = fresh.content.trimEnd() + "\n" + text.trim() + "\n"
                val newSha     = ghApi.putFile(path, retryContent, fresh.sha, "memory: append $key.md [$date] (retry)")
                GitHubFile(content = retryContent, sha = newSha)
            } else throw e
        }
    }

    suspend fun chat(
        systemPrompt: String,
        history: List<ChatMessage>,
        userMessage: String,
        userImageBase64: String? = null
    ): String = orApi.chat(systemPrompt, history, userMessage, userImageBase64)

    // Primer paso de tool calling en Android (ver Tools.kt / PendientesRepository.kt).
    suspend fun loadActivePendientes(): List<Pendiente> = pendientesRepo.loadActivePendientes()

    // Idea #10: historial de conversaciones por "Hey Miku" (ver VoiceHistoryRepository.kt).
    suspend fun loadVoiceHistory(): List<VoiceHistoryEntry> = voiceHistoryRepo.load()
    suspend fun appendVoiceHistory(heard: String, reply: String) = voiceHistoryRepo.append(heard, reply)

    // Idea #8 (de verdad): Miku decide en personaje si vale la pena
    // mencionar un correo nuevo, en vez de una plantilla fija -- mismo
    // criterio que useGmailWatcher.ts del lado desktop.
    suspend fun mentionNewMail(candidates: List<GmailMessageSummary>): String? {
        val memory = loadMemory()
        val prompt = Prompts.buildMailPrompt(memory, candidates)
        val raw = orApi.chat(prompt, emptyList(), "Revisa el correo nuevo y decide si me cuentas algo.")
        val clean = MarkerParser.parse(raw).cleanText
        return if (clean.isBlank() || clean.uppercase().contains("SILENCIO")) null else clean
    }

    suspend fun chatWithTools(
        systemPrompt: String,
        history: List<ChatMessage>,
        userMessage: String,
        userImageBase64: String? = null
    ): String = orApi.chatWithTools(
        systemPrompt,
        history,
        userMessage,
        userImageBase64,
        Tools.schemas(),
    ) { name, argumentsJson -> Tools.execute(name, argumentsJson, pendientesRepo, spotifyApi, gmailApi, calendarApi) }

    // Segundo paso de "Miku en Android" (ver SpotifyAuth.kt / SpotifyApi.kt).
    suspend fun connectSpotify() = spotifyAuth.connect()
    fun isSpotifyConnected(): Boolean = spotifyAuth.isConnected()

    // Tercer paso de "Miku en Android" (ver GmailAuth.kt / GmailApi.kt).
    suspend fun connectGmail(): String = gmailAuth.connect()
    fun listConnectedGmailEmails(): List<String> = gmailAuth.listConnectedEmails()
    fun disconnectGmailAccount(email: String) = gmailAuth.disconnect(email)

    // Idea #7: Google Calendar (ver CalendarAuth.kt / CalendarApi.kt).
    suspend fun connectCalendar(): String = calendarAuth.connect()
    fun listConnectedCalendarEmails(): List<String> = calendarAuth.listConnectedEmails()
    fun disconnectCalendarAccount(email: String) = calendarAuth.disconnect(email)
}
