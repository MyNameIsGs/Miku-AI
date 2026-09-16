package com.sebas.mikuai.data

import java.time.LocalDate

class MikuRepository(ghToken: String, orKey: String) {

    private val ghApi = GitHubApi(ghToken)
    private val orApi = OpenRouterApi(orKey)

    suspend fun loadMemory(): MikuMemory {
        return MikuMemory(
            world       = ghApi.getFile("memory/world.md"),
            personality = ghApi.getFile("memory/personality.md"),
            memories    = ghApi.getFile("memory/memories.md")
        )
    }

    suspend fun appendToFile(
        memory: MikuMemory,
        key: String,
        text: String
    ): GitHubFile {
        val path    = "memory/$key.md"
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
        userMessage: String
    ): String = orApi.chat(systemPrompt, history, userMessage)
}