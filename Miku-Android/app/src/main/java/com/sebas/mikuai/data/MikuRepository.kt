package com.sebas.mikuai.data

import android.content.Context
import java.time.LocalDate

class MikuRepository(ghToken: String, orKey: String, context: Context, prefs: SecurePrefs) {

    private val ghApi = GitHubApi(ghToken)
    private val orApi = OpenRouterApi(orKey)
    private val pendientesRepo = PendientesRepository(ghApi)
    private val spotifyAuth = SpotifyAuth(context, prefs)
    private val spotifyApi = SpotifyApi(spotifyAuth)
    private val gmailAuth = GmailAuth(context, prefs)
    private val gmailApi = GmailApi(gmailAuth)

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
    ) { name, argumentsJson -> Tools.execute(name, argumentsJson, pendientesRepo, spotifyApi, gmailApi) }

    // Segundo paso de "Miku en Android" (ver SpotifyAuth.kt / SpotifyApi.kt).
    suspend fun connectSpotify() = spotifyAuth.connect()
    fun isSpotifyConnected(): Boolean = spotifyAuth.isConnected()

    // Tercer paso de "Miku en Android" (ver GmailAuth.kt / GmailApi.kt).
    suspend fun connectGmail(): String = gmailAuth.connect()
    fun listConnectedGmailEmails(): List<String> = gmailAuth.listConnectedEmails()
    fun disconnectGmailAccount(email: String) = gmailAuth.disconnect(email)
}
