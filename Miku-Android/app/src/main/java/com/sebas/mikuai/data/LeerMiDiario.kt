package com.sebas.mikuai.data

import org.json.JSONObject
import java.text.Normalizer

/**
 * Tool leer_mi_diario en Android (2026-10-25), la misma que
 * lib/tools/leerMiDiario.ts de desktop (D5): su diario no se carga en la
 * charla (es largo y es para ella); con esta tool lo lee cuando quiere
 * recordar lo que escribió. Lo escribe desktop cada noche y llega acá por
 * GitHub (Miku-AI/memory/diario.md). Por fecha y por texto, igual que allá.
 */
object LeerMiDiario {

    private const val PATH = "Miku-AI/memory/diario.md"
    private const val MAX_CHARS = 4000
    private const val MAX_ENTRIES = 3
    private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

    data class Entry(val date: String, val text: String)

    suspend fun execute(github: GitHubApi, args: JSONObject): String = try {
        val entries = parse(github.getFile(PATH).content)
        if (entries.isEmpty()) {
            "Tu diario todavía no tiene entradas."
        } else {
            val date = args.optString("fecha", "").trim().takeIf { DATE.matches(it) }
            val query = args.optString("busqueda", "").trim().ifEmpty { null }
            val found = entries
                .filter { date == null || it.date == date }
                .filter { query == null || matches(it.text, query) }
                .reversed()
                .take(MAX_ENTRIES)
            if (found.isEmpty()) {
                "No escribiste nada" + (date?.let { " el $it" } ?: "") + (query?.let { " sobre \"$it\"" } ?: "") + "."
            } else {
                val text = found.joinToString("\n\n") { "## ${it.date}\n${it.text}" }
                if (text.length > MAX_CHARS) text.take(MAX_CHARS) + "…" else text
            }
        }
    } catch (e: Exception) {
        "Error al leer tu diario: ${e.message}"
    }

    // "## YYYY-MM-DD" seguido de la entrada (ver parseDiary en desktop); el
    // encabezado del archivo no es una entrada.
    private fun parse(content: String): List<Entry> =
        content.split(Regex("\n(?=## \\d{4}-\\d{2}-\\d{2})")).mapNotNull { section ->
            Regex("^## (\\d{4}-\\d{2}-\\d{2})\\s*\\n?([\\s\\S]*)$").find(section)?.let {
                Entry(it.groupValues[1], it.groupValues[2].trim())
            }
        }.filter { it.text.isNotEmpty() }

    // Todas las palabras, sin importar tildes ni mayúsculas (matchesQuery de desktop).
    private fun matches(text: String, query: String): Boolean {
        val haystack = fold(text)
        return fold(query).split(Regex("\\s+")).filter { it.isNotEmpty() }.all { haystack.contains(it) }
    }

    private fun fold(text: String): String =
        Normalizer.normalize(text.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")
}
