package com.sebas.mikuai.data

import android.content.Context
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
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

    suspend fun loadMemory(): MikuMemory = coroutineScope {
        // En paralelo: con conocimiento.md (Tarea 8.11) son 4 pedidos a
        // GitHub, y uno detrás del otro sumaban latencia a cada "Hey Miku".
        val world       = async { ghApi.getFile("Miku-AI/memory/world.md") }
        val personality = async { ghApi.getFile("Miku-AI/memory/personality.md") }
        val memories    = async { ghApi.getFile("Miku-AI/memory/memories.md") }
        // Si todavía no existe (nunca se guardó conocimiento), vacío -- sha
        // vacío = appendToFile lo crea en vez de sobreescribirlo.
        val knowledge   = async {
            try { ghApi.getFile("Miku-AI/memory/conocimiento.md") } catch (e: Exception) { GitHubFile("", "") }
        }
        MikuMemory(
            world       = world.await(),
            personality = personality.await(),
            memories    = memories.await(),
            knowledge   = knowledge.await()
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
            "conocimiento" -> memory.knowledge
            else          -> throw IllegalArgumentException("Archivo desconocido: $key")
        }
        // conocimiento.md separa cada entrada con una línea en blanco: así
        // el desktop (lib/knowledge.ts) la indexa como una entrada propia.
        val separator = if (key == "conocimiento") "\n\n" else "\n"
        val newContent = current.content.trimEnd() + separator + text.trim() + "\n"

        return try {
            // sha vacío = el archivo todavía no existe (ver loadMemory): se crea.
            val newSha = ghApi.putFile(path, newContent, current.sha.ifEmpty { null }, "memory: append $key.md [$date]")
            GitHubFile(content = newContent, sha = newSha)
        } catch (e: Exception) {
            // SHA obsoleto: re-fetch y reintentar
            if (e.message?.contains("409") == true || e.message?.contains("422") == true) {
                val fresh      = ghApi.getFile(path)
                val retryContent = fresh.content.trimEnd() + separator + text.trim() + "\n"
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

    // Idea #8.7: briefing automático al sentarse -- mismo criterio que
    // useBriefing.ts del lado desktop: la primera vez que Sebastián habla
    // en el día, junta calendario+correo+pendientes (sin pasar por tool
    // calling) y arma UN mensaje. El flag se marca ANTES de terminar --
    // mejor perderse el de hoy que reintentarlo en cada mensaje si algo
    // falla, mismo criterio que el resto de los chequeos de fondo.
    suspend fun maybeBuildBriefing(prefs: SecurePrefs): String? {
        val today = LocalDate.now().toString()
        if (prefs.getLastBriefingDate() == today) return null
        prefs.setLastBriefingDate(today)

        val events = try {
            calendarApi.listUpcomingEventsAllAccounts(7, 15)
        } catch (e: Exception) {
            emptyList()
        }
        val mails = try {
            gmailApi.listRecentMessagesAllAccounts(15, 3)
        } catch (e: Exception) {
            emptyList()
        }
        val pendientes = try {
            pendientesRepo.loadActivePendientes()
        } catch (e: Exception) {
            emptyList()
        }

        val memory = loadMemory()
        val prompt = Prompts.buildBriefingPrompt(memory, events, mails, pendientes)
        val raw = orApi.chat(prompt, emptyList(), "Repasa mi día y decide si me cuentas algo antes de responderme.")
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
