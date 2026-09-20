package com.sebas.mikuai.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

// Mismo Client ID que usa la app de escritorio -- no es un secreto real
// (Authorization Code + PKCE está pensado justamente para no necesitarlo
// escondido), así que no hace falta pedirle a Sebastián que lo ingrese de
// nuevo ni guardarlo cifrado.
private const val CLIENT_ID = "7b91727b02594af5afdc10917037b377"
// A diferencia del listener de loopback TCP que usa desktop (no viable en
// Android), acá el redirect vuelve por un esquema de URL propio, capturado
// por un intent-filter en MainActivity. Hay que registrar ESTE valor como
// Redirect URI adicional en la misma app del dashboard de Spotify.
private const val REDIRECT_URI = "mikuai://spotify-callback"
// playlist-read-private/collaborative: agregado para reproducir_playlist,
// que necesita leer /me/playlists (playlists propias y seguidas) -- la
// búsqueda pública de Spotify apenas encuentra contenido privado del
// usuario.
private const val SCOPES =
    "user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative"
private const val TOKEN_URL = "https://accounts.spotify.com/api/token"

class SpotifyAuth(private val context: Context, private val prefs: SecurePrefs) {

    private val client = OkHttpClient()

    private fun generateCodeVerifier(): String {
        val bytes = ByteArray(64)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    private fun generateCodeChallenge(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    private fun generateState(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    fun isConnected(): Boolean = prefs.getSpotifyTokens() != null

    // Arranca el flujo de conexión: abre el navegador del sistema para que
    // Sebastián autorice, y espera a que MainActivity reciba el deep link
    // de vuelta (ver SpotifyAuthBridge) y cambia el código por tokens.
    // Igual que en desktop, el intercambio se hace con una llamada HTTP
    // directa (acá con OkHttp, ya dependencia del proyecto) -- en Android
    // ni siquiera aplica la duda de CORS que sí importaba en el webview de
    // Tauri, porque no hay navegador de por medio para esta parte.
    suspend fun connect() {
        val verifier = generateCodeVerifier()
        val challenge = generateCodeChallenge(verifier)
        val state = generateState()

        val authorizeUrl = Uri.parse("https://accounts.spotify.com/authorize").buildUpon()
            .appendQueryParameter("client_id", CLIENT_ID)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("redirect_uri", REDIRECT_URI)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("scope", SCOPES)
            .appendQueryParameter("state", state)
            .build()

        val deferred = SpotifyAuthBridge.awaitRedirect()

        withContext(Dispatchers.Main) {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, authorizeUrl).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }

        val redirectUri = try {
            // Mismo margen que el listener de loopback de desktop (3 min).
            withTimeout(180_000) { deferred.await() }
        } catch (e: TimeoutCancellationException) {
            throw IllegalStateException("Se agotó el tiempo esperando que autorices en el navegador (3 minutos).")
        }

        if (redirectUri.getQueryParameter("state") != state) {
            throw IllegalStateException(
                "El callback de Spotify no coincide con esta sesión -- por seguridad, no se usa."
            )
        }
        val oauthError = redirectUri.getQueryParameter("error")
        if (oauthError != null) {
            throw IllegalStateException("Spotify rechazó la autorización: $oauthError")
        }
        val code = redirectUri.getQueryParameter("code")
            ?: throw IllegalStateException("Spotify no mandó ningún código de autorización.")

        withContext(Dispatchers.IO) {
            val body = FormBody.Builder()
                .add("grant_type", "authorization_code")
                .add("code", code)
                .add("redirect_uri", REDIRECT_URI)
                .add("client_id", CLIENT_ID)
                .add("code_verifier", verifier)
                .build()

            val response = client.newCall(Request.Builder().url(TOKEN_URL).post(body).build()).execute()
            if (!response.isSuccessful) {
                throw IllegalStateException(
                    "Spotify devolvió un error al pedir el token: ${response.body?.string()}"
                )
            }
            val json = JSONObject(response.body!!.string())
            prefs.setSpotifyTokens(
                accessToken = json.getString("access_token"),
                refreshToken = json.getString("refresh_token"),
                expiresAt = System.currentTimeMillis() + json.getLong("expires_in") * 1000,
            )
        }
    }

    private fun refresh(refreshToken: String): String {
        val body = FormBody.Builder()
            .add("grant_type", "refresh_token")
            .add("refresh_token", refreshToken)
            .add("client_id", CLIENT_ID)
            .build()

        val response = client.newCall(Request.Builder().url(TOKEN_URL).post(body).build()).execute()
        if (!response.isSuccessful) {
            throw IllegalStateException("Error refrescando el token de Spotify: ${response.code}")
        }
        val json = JSONObject(response.body!!.string())
        val newAccessToken = json.getString("access_token")
        // Spotify no siempre manda un refresh_token nuevo -- si no vino,
        // el anterior sigue valiendo.
        val newRefreshToken = if (json.has("refresh_token")) json.getString("refresh_token") else refreshToken
        prefs.setSpotifyTokens(
            accessToken = newAccessToken,
            refreshToken = newRefreshToken,
            expiresAt = System.currentTimeMillis() + json.getLong("expires_in") * 1000,
        )
        return newAccessToken
    }

    // Para usar antes de cualquier llamada a la Web API -- refresca solo
    // si falta menos de un minuto para que expire. Si el refresh falla
    // (revocado), se limpian los tokens en vez de tirar un error críptico
    // cada vez, así la próxima llamada simplemente informa que Spotify no
    // está conectado.
    suspend fun getValidAccessToken(): String? = withContext(Dispatchers.IO) {
        val stored = prefs.getSpotifyTokens() ?: return@withContext null
        if (stored.expiresAt - System.currentTimeMillis() > 60_000) {
            return@withContext stored.accessToken
        }
        try {
            refresh(stored.refreshToken)
        } catch (e: Exception) {
            prefs.clearSpotifyTokens()
            null
        }
    }
}
