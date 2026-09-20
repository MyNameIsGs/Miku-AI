package com.sebas.mikuai.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

data class GmailMessageSummary(
    val account: String,
    val from: String,
    val subject: String,
    val date: String,
    val snippet: String,
)

class GmailApi(private val auth: GmailAuth) {

    private val client = OkHttpClient()

    private fun headerValue(headers: JSONArray, name: String): String {
        for (i in 0 until headers.length()) {
            val header = headers.getJSONObject(i)
            if (header.getString("name").equals(name, ignoreCase = true)) {
                return header.getString("value")
            }
        }
        return ""
    }

    // Privacidad por diseño (mismo criterio que desktop): pide
    // format=metadata, que trae solo encabezados (De/Asunto/Fecha) más el
    // "snippet" corto que la propia API de Gmail genera -- nunca el
    // cuerpo completo del correo.
    private suspend fun listRecentForAccount(
        email: String,
        accessToken: String,
        maxResults: Int,
        daysBack: Int,
    ): List<GmailMessageSummary> = withContext(Dispatchers.IO) {
        val listUrl = "https://www.googleapis.com/gmail/v1/users/me/messages" +
            "?q=newer_than:${daysBack}d&maxResults=$maxResults"
        val listResponse = client.newCall(
            Request.Builder().url(listUrl).addHeader("Authorization", "Bearer $accessToken").build()
        ).execute()
        if (!listResponse.isSuccessful) {
            throw IllegalStateException("Error listando correos de $email: ${listResponse.body?.string()}")
        }
        val listJson = JSONObject(listResponse.body!!.string())
        val messages = listJson.optJSONArray("messages") ?: return@withContext emptyList()

        val result = mutableListOf<GmailMessageSummary>()
        for (i in 0 until messages.length()) {
            val id = messages.getJSONObject(i).getString("id")
            val url = "https://www.googleapis.com/gmail/v1/users/me/messages/$id" +
                "?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date"
            val response = client.newCall(
                Request.Builder().url(url).addHeader("Authorization", "Bearer $accessToken").build()
            ).execute()
            if (!response.isSuccessful) continue
            val json = JSONObject(response.body!!.string())
            val headers = json.getJSONObject("payload").optJSONArray("headers") ?: JSONArray()
            result.add(
                GmailMessageSummary(
                    account = email,
                    from = headerValue(headers, "From"),
                    subject = headerValue(headers, "Subject"),
                    date = headerValue(headers, "Date"),
                    snippet = json.optString("snippet", ""),
                )
            )
        }
        result
    }

    // Recorre TODAS las cuentas de Gmail conectadas y junta los
    // resultados -- si una cuenta falla (token vencido y no se pudo
    // refrescar, error de red) se la saltea sin romper las demás.
    suspend fun listRecentMessagesAllAccounts(maxResults: Int = 15, daysBack: Int = 7): List<GmailMessageSummary> {
        val emails = auth.listConnectedEmails()
        if (emails.isEmpty()) {
            throw IllegalStateException(
                "Gmail no está conectado -- hay que conectar al menos una cuenta desde Configuración.",
            )
        }
        val result = mutableListOf<GmailMessageSummary>()
        for (email in emails) {
            val token = auth.getValidAccessToken(email) ?: continue
            try {
                result.addAll(listRecentForAccount(email, token, maxResults, daysBack))
            } catch (e: Exception) {
                // Un problema en una cuenta no debería tapar los
                // resultados de las demás.
            }
        }
        return result
    }
}
