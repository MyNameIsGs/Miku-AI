package com.sebas.mikuai.data

import android.content.Context
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Task
import com.sebas.mikuai.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// Google Calendar (idea #7 del plan) -- mismo diseño que GmailAuth.kt:
// AuthorizationClient de Play Services (sin navegador ni redirect),
// reusando el MISMO cliente OAuth tipo "Aplicación web" que ya usa Gmail
// (BuildConfig.GMAIL_WEB_CLIENT_ID/SECRET) -- un cliente puede pedir
// distintos scopes en distintos pedidos de autorización, no hace falta
// uno nuevo por servicio. También reusa GmailAuthBridge (genérico pese al
// nombre, solo resuelve un IntentSenderRequest de Play Services) en vez
// de registrar un ActivityResultLauncher nuevo en MainActivity.
private val WEB_CLIENT_ID = BuildConfig.GMAIL_WEB_CLIENT_ID
private val WEB_CLIENT_SECRET = BuildConfig.GMAIL_WEB_CLIENT_SECRET
// Solo lectura -- mismo criterio de privacidad que Gmail.
private const val CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
private const val TOKEN_URL = "https://oauth2.googleapis.com/token"

class CalendarAuth(context: Context, private val prefs: SecurePrefs) {

    private val authorizationClient = Identity.getAuthorizationClient(context)
    private val httpClient = OkHttpClient()

    fun listConnectedEmails(): List<String> = prefs.getCalendarAccounts().map { it.email }

    fun disconnect(email: String) {
        prefs.setCalendarAccounts(prefs.getCalendarAccounts().filter { it.email != email })
    }

    suspend fun connect(): String {
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(CALENDAR_SCOPE)))
            .requestOfflineAccess(WEB_CLIENT_ID, true)
            // Sin esto, authorize() reutiliza en silencio la cuenta ya
            // autorizada -- mismo fix que ya se aplicó a Gmail tras el
            // bug real de "+ Otra cuenta" reconfirmando la misma.
            .setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
            .build()

        val result = awaitTask(authorizationClient.authorize(request))

        val finalResult = if (result.hasResolution()) {
            val pendingIntent = result.pendingIntent
                ?: throw IllegalStateException("Google no ofreció ninguna forma de autorizar.")
            val data = GmailAuthBridge.resolve(pendingIntent)
                ?: throw IllegalStateException("Se canceló la autorización de Calendar.")
            authorizationClient.getAuthorizationResultFromIntent(data)
        } else {
            result
        }

        val serverAuthCode = finalResult.serverAuthCode
            ?: throw IllegalStateException("Google no mandó ningún código de autorización.")

        return exchangeCode(serverAuthCode)
    }

    private suspend fun exchangeCode(code: String): String = withContext(Dispatchers.IO) {
        val body = FormBody.Builder()
            .add("grant_type", "authorization_code")
            .add("code", code)
            .add("client_id", WEB_CLIENT_ID)
            .add("client_secret", WEB_CLIENT_SECRET)
            .build()

        val response = httpClient.newCall(Request.Builder().url(TOKEN_URL).post(body).build()).execute()
        if (!response.isSuccessful) {
            throw IllegalStateException("Google rechazó el pedido de token: ${response.body?.string()}")
        }
        val json = JSONObject(response.body!!.string())
        val accessToken = json.getString("access_token")
        val refreshToken = json.getString("refresh_token")
        val expiresAt = System.currentTimeMillis() + json.getLong("expires_in") * 1000

        val email = fetchPrimaryCalendarEmail(accessToken)
        val accounts = prefs.getCalendarAccounts().filter { it.email != email }
        prefs.setCalendarAccounts(accounts + CalendarAccount(email, accessToken, refreshToken, expiresAt))
        email
    }

    // El calendario "primary" de una cuenta usa el email de esa cuenta
    // como su propio id -- equivalente de /gmail/v1/users/me/profile.
    private fun fetchPrimaryCalendarEmail(accessToken: String): String {
        val response = httpClient.newCall(
            Request.Builder()
                .url("https://www.googleapis.com/calendar/v3/calendars/primary")
                .addHeader("Authorization", "Bearer $accessToken")
                .build()
        ).execute()
        if (!response.isSuccessful) {
            throw IllegalStateException("Error obteniendo el calendario principal: ${response.body?.string()}")
        }
        return JSONObject(response.body!!.string()).getString("id")
    }

    private fun refresh(account: CalendarAccount): CalendarAccount {
        val body = FormBody.Builder()
            .add("grant_type", "refresh_token")
            .add("refresh_token", account.refreshToken)
            .add("client_id", WEB_CLIENT_ID)
            .add("client_secret", WEB_CLIENT_SECRET)
            .build()
        val response = httpClient.newCall(Request.Builder().url(TOKEN_URL).post(body).build()).execute()
        if (!response.isSuccessful) {
            throw IllegalStateException("Error refrescando el token de Calendar: ${response.code}")
        }
        val json = JSONObject(response.body!!.string())
        val refreshed = account.copy(
            accessToken = json.getString("access_token"),
            expiresAt = System.currentTimeMillis() + json.getLong("expires_in") * 1000,
        )
        val accounts = prefs.getCalendarAccounts().map { if (it.email == account.email) refreshed else it }
        prefs.setCalendarAccounts(accounts)
        return refreshed
    }

    suspend fun getValidAccessToken(email: String): String? = withContext(Dispatchers.IO) {
        val account = prefs.getCalendarAccounts().find { it.email == email } ?: return@withContext null
        if (account.expiresAt - System.currentTimeMillis() > 60_000) {
            return@withContext account.accessToken
        }
        try {
            refresh(account).accessToken
        } catch (e: Exception) {
            disconnect(email)
            null
        }
    }
}

private suspend fun <T> awaitTask(task: Task<T>): T = suspendCancellableCoroutine { cont ->
    task.addOnSuccessListener { cont.resume(it) }
    task.addOnFailureListener { cont.resumeWithException(it) }
}
