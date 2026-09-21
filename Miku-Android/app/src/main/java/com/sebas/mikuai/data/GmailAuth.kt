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

// Client ID/Secret del cliente OAuth tipo "Aplicación web" del mismo
// proyecto de Google Cloud que ya usa Gmail en desktop -- distinto del
// cliente tipo "Android" (ese solo verifica la firma de la app por
// nombre de paquete + SHA-1, nunca se referencia en código). Vienen de
// local.properties vía BuildConfig, no hardcodeados: a diferencia del
// Client ID de Spotify (PKCE, no es secreto), el Client Secret de Gmail
// sí lo es, y el repo es público.
private val WEB_CLIENT_ID = BuildConfig.GMAIL_WEB_CLIENT_ID
private val WEB_CLIENT_SECRET = BuildConfig.GMAIL_WEB_CLIENT_SECRET
// Nivel 3 de la Tarea 6.7: solo lectura, nunca enviar/borrar/modificar.
private const val GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
private const val TOKEN_URL = "https://oauth2.googleapis.com/token"

class GmailAuth(context: Context, private val prefs: SecurePrefs) {

    private val authorizationClient = Identity.getAuthorizationClient(context)
    private val httpClient = OkHttpClient()

    fun listConnectedEmails(): List<String> = prefs.getGmailAccounts().map { it.email }

    fun disconnect(email: String) {
        prefs.setGmailAccounts(prefs.getGmailAccounts().filter { it.email != email })
    }

    // Arranca el flujo nativo de Google (sin navegador, sin redirect) --
    // si Play Services necesita que Sebastián elija cuenta o apruebe el
    // permiso, muestra un diálogo del sistema, resuelto vía
    // GmailAuthBridge. Devuelve el email de la cuenta recién conectada.
    suspend fun connect(): String {
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(GMAIL_SCOPE)))
            // true = forzar que Google mande un refresh_token nuevo,
            // aunque esa cuenta ya se haya autorizado antes en la vida de
            // esta app (mismo motivo que prompt=consent en desktop).
            .requestOfflineAccess(WEB_CLIENT_ID, true)
            // Sin esto, authorize() reutiliza en silencio la cuenta ya
            // autorizada en el dispositivo y nunca ofrece elegir otra --
            // por eso "+ Otra cuenta" reconfirmaba la misma. Equivalente
            // Android de prompt=select_account del flujo de desktop.
            .setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
            .build()

        val result = awaitTask(authorizationClient.authorize(request))

        val finalResult = if (result.hasResolution()) {
            val pendingIntent = result.pendingIntent
                ?: throw IllegalStateException("Google no ofreció ninguna forma de autorizar.")
            val data = GmailAuthBridge.resolve(pendingIntent)
                ?: throw IllegalStateException("Se canceló la autorización de Gmail.")
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
            // Sin redirect_uri -- este flujo nativo de Android no usa uno,
            // a diferencia del flujo de navegador que usa desktop.
            .build()

        val response = httpClient.newCall(Request.Builder().url(TOKEN_URL).post(body).build()).execute()
        if (!response.isSuccessful) {
            throw IllegalStateException("Google rechazó el pedido de token: ${response.body?.string()}")
        }
        val json = JSONObject(response.body!!.string())
        val accessToken = json.getString("access_token")
        val refreshToken = json.getString("refresh_token")
        val expiresAt = System.currentTimeMillis() + json.getLong("expires_in") * 1000

        val email = fetchProfileEmail(accessToken)
        val accounts = prefs.getGmailAccounts().filter { it.email != email }
        prefs.setGmailAccounts(accounts + GmailAccount(email, accessToken, refreshToken, expiresAt))
        email
    }

    private fun fetchProfileEmail(accessToken: String): String {
        val response = httpClient.newCall(
            Request.Builder()
                .url("https://www.googleapis.com/gmail/v1/users/me/profile")
                .addHeader("Authorization", "Bearer $accessToken")
                .build()
        ).execute()
        if (!response.isSuccessful) {
            throw IllegalStateException("Error obteniendo el perfil de Gmail: ${response.body?.string()}")
        }
        return JSONObject(response.body!!.string()).getString("emailAddress")
    }

    private fun refresh(account: GmailAccount): GmailAccount {
        val body = FormBody.Builder()
            .add("grant_type", "refresh_token")
            .add("refresh_token", account.refreshToken)
            .add("client_id", WEB_CLIENT_ID)
            .add("client_secret", WEB_CLIENT_SECRET)
            .build()
        val response = httpClient.newCall(Request.Builder().url(TOKEN_URL).post(body).build()).execute()
        if (!response.isSuccessful) {
            throw IllegalStateException("Error refrescando el token de Gmail: ${response.code}")
        }
        val json = JSONObject(response.body!!.string())
        val refreshed = account.copy(
            accessToken = json.getString("access_token"),
            expiresAt = System.currentTimeMillis() + json.getLong("expires_in") * 1000,
        )
        val accounts = prefs.getGmailAccounts().map { if (it.email == account.email) refreshed else it }
        prefs.setGmailAccounts(accounts)
        return refreshed
    }

    // Con la app de Google en modo "Testing" (mismo criterio que
    // desktop), el refresh_token expira cada 7 días -- si el refresh
    // falla, esa cuenta se desconecta sola en vez de fallar en silencio
    // cada vez.
    suspend fun getValidAccessToken(email: String): String? = withContext(Dispatchers.IO) {
        val account = prefs.getGmailAccounts().find { it.email == email } ?: return@withContext null
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
