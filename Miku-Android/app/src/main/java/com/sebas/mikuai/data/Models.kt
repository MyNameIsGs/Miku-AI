package com.sebas.mikuai.data

data class ChatMessage(
    val role: String,   // "user" o "assistant"
    val content: String,
    val imageUrlBase64: String? = null // NUEVA: Para guardar la imagen opcional en base64 en peticiones de visión
)

data class GitHubFile(
    val content: String,
    val sha: String
)

data class MikuMemory(
    val world: GitHubFile,
    val personality: GitHubFile,
    val memories: GitHubFile,
    // Tarea 8.11: memorias "de agente" (saber práctico). En desktop se
    // buscan por similitud; acá el archivo se carga completo (es chico, y
    // el teléfono no tiene el modelo de embeddings).
    val knowledge: GitHubFile
)

data class ParsedResponse(
    val cleanText: String,
    val savePersonality: List<String>,
    val saveMemories: List<String>,
    val saveKnowledge: List<String> = emptyList()
)