package com.sebas.mikuai.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

data class CalendarEventSummary(
    val account: String,
    val id: String,
    val summary: String,
    // ISO si tiene hora, o "YYYY-MM-DD" si es de todo el día.
    val start: String,
    val location: String,
)

class CalendarApi(private val auth: CalendarAuth) {

    private val client = OkHttpClient()

    fun listConnectedEmails(): List<String> = auth.listConnectedEmails()

    private suspend fun listEventsForAccount(
        email: String,
        accessToken: String,
        timeMinIso: String,
        timeMaxIso: String,
        maxResults: Int,
    ): List<CalendarEventSummary> = withContext(Dispatchers.IO) {
        val url = "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
            "?timeMin=$timeMinIso&timeMax=$timeMaxIso&singleEvents=true&orderBy=startTime&maxResults=$maxResults"
        val response = client.newCall(
            Request.Builder().url(url).addHeader("Authorization", "Bearer $accessToken").build()
        ).execute()
        if (!response.isSuccessful) {
            throw IllegalStateException("Error listando eventos de $email: ${response.body?.string()}")
        }
        val json = JSONObject(response.body!!.string())
        val items = json.optJSONArray("items") ?: return@withContext emptyList()
        (0 until items.length()).map { i ->
            val item = items.getJSONObject(i)
            val start = item.optJSONObject("start")
            CalendarEventSummary(
                account = email,
                id = item.getString("id"),
                summary = item.optString("summary", "(sin título)"),
                start = start?.optString("dateTime") ?: start?.optString("date") ?: "",
                location = item.optString("location", ""),
            )
        }
    }

    suspend fun listUpcomingEventsAllAccounts(
        withinDays: Int = 7,
        maxResultsPerAccount: Int = 15,
    ): List<CalendarEventSummary> {
        val emails = auth.listConnectedEmails()
        if (emails.isEmpty()) {
            throw IllegalStateException(
                "Calendar no está conectado -- hay que conectar al menos una cuenta desde Configuración.",
            )
        }
        val nowMs = System.currentTimeMillis()
        val timeMinIso = isoFormat(nowMs)
        val timeMaxIso = isoFormat(nowMs + withinDays * 24L * 60 * 60 * 1000)

        val result = mutableListOf<CalendarEventSummary>()
        for (email in emails) {
            val token = auth.getValidAccessToken(email) ?: continue
            try {
                result.addAll(listEventsForAccount(email, token, timeMinIso, timeMaxIso, maxResultsPerAccount))
            } catch (e: Exception) {
                // una cuenta que falla no debe tapar los resultados de las demás
            }
        }
        return result
    }

    // Ventana corta (minutos) para el aviso de "está por empezar" -- ver
    // CalendarWatcher.kt. Silenciosa (no tira excepción) si Calendar no
    // está conectado -- el watcher corre siempre en el fondo, no a pedido.
    suspend fun listEventsStartingWithin(withinMinutes: Int): List<CalendarEventSummary> {
        val emails = auth.listConnectedEmails()
        if (emails.isEmpty()) return emptyList()
        val nowMs = System.currentTimeMillis()
        val timeMinIso = isoFormat(nowMs)
        val timeMaxIso = isoFormat(nowMs + withinMinutes * 60L * 1000)

        val result = mutableListOf<CalendarEventSummary>()
        for (email in emails) {
            val token = auth.getValidAccessToken(email) ?: continue
            try {
                result.addAll(listEventsForAccount(email, token, timeMinIso, timeMaxIso, 10))
            } catch (e: Exception) {
            }
        }
        return result
    }

    private fun isoFormat(epochMs: Long): String {
        val instant = java.time.Instant.ofEpochMilli(epochMs)
        return java.time.format.DateTimeFormatter.ISO_INSTANT.format(instant)
    }
}
