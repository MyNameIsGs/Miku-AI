package com.sebas.mikuai.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

class SecurePrefs(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "miku_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun getGitHubToken(): String? = prefs.getString(KEY_GH, null)
    fun setGitHubToken(token: String) = prefs.edit().putString(KEY_GH, token).apply()

    fun getOpenRouterKey(): String? = prefs.getString(KEY_OR, null)
    fun setOpenRouterKey(key: String) = prefs.edit().putString(KEY_OR, key).apply()

    fun hasCredentials(): Boolean = !getGitHubToken().isNullOrBlank() && !getOpenRouterKey().isNullOrBlank()

    // Spotify: cuenta única (a diferencia de Gmail en desktop, que soporta
    // varias) -- mismo criterio que la integración de Spotify en desktop.
    fun getSpotifyTokens(): SpotifyTokens? {
        val access = prefs.getString(KEY_SPOTIFY_ACCESS, null) ?: return null
        val refresh = prefs.getString(KEY_SPOTIFY_REFRESH, null) ?: return null
        val expiresAt = prefs.getLong(KEY_SPOTIFY_EXPIRES, 0L)
        return SpotifyTokens(access, refresh, expiresAt)
    }

    fun setSpotifyTokens(accessToken: String, refreshToken: String, expiresAt: Long) {
        prefs.edit()
            .putString(KEY_SPOTIFY_ACCESS, accessToken)
            .putString(KEY_SPOTIFY_REFRESH, refreshToken)
            .putLong(KEY_SPOTIFY_EXPIRES, expiresAt)
            .apply()
    }

    fun clearSpotifyTokens() {
        prefs.edit()
            .remove(KEY_SPOTIFY_ACCESS)
            .remove(KEY_SPOTIFY_REFRESH)
            .remove(KEY_SPOTIFY_EXPIRES)
            .apply()
    }

    // Gmail: varias cuentas a la vez (Sebastián usa varias) -- mismo
    // criterio que Gmail en desktop. EncryptedSharedPreferences no
    // soporta listas nativamente, así que se serializa como JSON.
    fun getGmailAccounts(): List<GmailAccount> {
        val raw = prefs.getString(KEY_GMAIL_ACCOUNTS, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            (0 until array.length()).map { i ->
                val obj = array.getJSONObject(i)
                GmailAccount(
                    email = obj.getString("email"),
                    accessToken = obj.getString("accessToken"),
                    refreshToken = obj.getString("refreshToken"),
                    expiresAt = obj.getLong("expiresAt"),
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun setGmailAccounts(accounts: List<GmailAccount>) {
        val array = JSONArray()
        accounts.forEach { a ->
            array.put(JSONObject().apply {
                put("email", a.email)
                put("accessToken", a.accessToken)
                put("refreshToken", a.refreshToken)
                put("expiresAt", a.expiresAt)
            })
        }
        prefs.edit().putString(KEY_GMAIL_ACCOUNTS, array.toString()).apply()
    }

    // Google Calendar (idea #7) -- mismo criterio que Gmail: varias
    // cuentas, serializado como JSON.
    fun getCalendarAccounts(): List<CalendarAccount> {
        val raw = prefs.getString(KEY_CALENDAR_ACCOUNTS, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            (0 until array.length()).map { i ->
                val obj = array.getJSONObject(i)
                CalendarAccount(
                    email = obj.getString("email"),
                    accessToken = obj.getString("accessToken"),
                    refreshToken = obj.getString("refreshToken"),
                    expiresAt = obj.getLong("expiresAt"),
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun setCalendarAccounts(accounts: List<CalendarAccount>) {
        val array = JSONArray()
        accounts.forEach { a ->
            array.put(JSONObject().apply {
                put("email", a.email)
                put("accessToken", a.accessToken)
                put("refreshToken", a.refreshToken)
                put("expiresAt", a.expiresAt)
            })
        }
        prefs.edit().putString(KEY_CALENDAR_ACCOUNTS, array.toString()).apply()
    }

    // Aviso de evento próximo (minutos antes) -- id de evento -> epoch ms
    // de cuándo se anunció. Puramente local, no sincronizado por GitHub
    // (mismo criterio que gmailLastSeenIds).
    fun getCalendarAnnouncedEvents(): Map<String, Long> {
        val raw = prefs.getString(KEY_CALENDAR_ANNOUNCED, null) ?: return emptyMap()
        return try {
            val obj = JSONObject(raw)
            obj.keys().asSequence().associateWith { obj.getLong(it) }
        } catch (e: Exception) {
            emptyMap()
        }
    }

    fun setCalendarAnnouncedEvents(announced: Map<String, Long>) {
        val obj = JSONObject()
        announced.forEach { (id, ts) -> obj.put(id, ts) }
        prefs.edit().putString(KEY_CALENDAR_ANNOUNCED, obj.toString()).apply()
    }

    // Avisos de anticipación larga (1 semana/3 días/el día anterior) -- id
    // de evento -> lista de umbrales (en días) ya anunciados para ESE
    // evento puntual.
    fun getCalendarMilestonesAnnounced(): Map<String, List<Int>> {
        val raw = prefs.getString(KEY_CALENDAR_MILESTONES, null) ?: return emptyMap()
        return try {
            val obj = JSONObject(raw)
            obj.keys().asSequence().associateWith { key ->
                val arr = obj.getJSONArray(key)
                (0 until arr.length()).map { arr.getInt(it) }
            }
        } catch (e: Exception) {
            emptyMap()
        }
    }

    fun setCalendarMilestonesAnnounced(announced: Map<String, List<Int>>) {
        val obj = JSONObject()
        announced.forEach { (id, days) -> obj.put(id, JSONArray(days)) }
        prefs.edit().putString(KEY_CALENDAR_MILESTONES, obj.toString()).apply()
    }

    // Último id de mensaje visto por cuenta de Gmail, para avisar solo de
    // correo REALMENTE nuevo (GmailWatcher.kt) -- a diferencia de
    // pendientes.json/voice_history.json, esto es puramente local: no
    // aporta nada sincronizarlo entre dispositivos, es solo "hasta dónde
    // ya avisé en ESTE teléfono".
    fun getLastSeenGmailIds(): Map<String, String> {
        val raw = prefs.getString(KEY_GMAIL_LAST_SEEN, null) ?: return emptyMap()
        return try {
            val obj = JSONObject(raw)
            obj.keys().asSequence().associateWith { obj.getString(it) }
        } catch (e: Exception) {
            emptyMap()
        }
    }

    fun setLastSeenGmailIds(ids: Map<String, String>) {
        val obj = JSONObject()
        ids.forEach { (email, id) -> obj.put(email, id) }
        prefs.edit().putString(KEY_GMAIL_LAST_SEEN, obj.toString()).apply()
    }

    /** Mensaje generado por el job de notificaciones, pendiente de mostrar en el chat. */
    fun getPendingNotificationMessage(): String? = prefs.getString(KEY_PENDING, null)
    fun setPendingNotificationMessage(msg: String) = prefs.edit().putString(KEY_PENDING, msg).apply()
    fun clearPendingNotificationMessage() = prefs.edit().remove(KEY_PENDING).apply()

    // Silenciar/activar la voz de "Hey Miku" -- independiente de CÓMO se
    // genere esa voz (hoy TextToSpeech del sistema; el bridge por red
    // local al servidor de desktop se probó y se revirtió, ver git log).
    fun isVoiceMuted(): Boolean = prefs.getBoolean(KEY_VOICE_MUTED, false)
    fun setVoiceMuted(muted: Boolean) = prefs.edit().putBoolean(KEY_VOICE_MUTED, muted).apply()

    fun clearAll() = prefs.edit().clear().apply()

    companion object {
        private const val KEY_GH      = "gh_token"
        private const val KEY_OR      = "or_key"
        private const val KEY_PENDING = "pending_notification"
        private const val KEY_SPOTIFY_ACCESS  = "spotify_access_token"
        private const val KEY_SPOTIFY_REFRESH = "spotify_refresh_token"
        private const val KEY_SPOTIFY_EXPIRES = "spotify_expires_at"
        private const val KEY_GMAIL_ACCOUNTS  = "gmail_accounts"
        private const val KEY_GMAIL_LAST_SEEN = "gmail_last_seen_ids"
        private const val KEY_CALENDAR_ACCOUNTS = "calendar_accounts"
        private const val KEY_CALENDAR_ANNOUNCED = "calendar_announced_events"
        private const val KEY_CALENDAR_MILESTONES = "calendar_milestones_announced"
        private const val KEY_VOICE_MUTED = "voice_muted"
    }
}

data class SpotifyTokens(val accessToken: String, val refreshToken: String, val expiresAt: Long)
data class GmailAccount(val email: String, val accessToken: String, val refreshToken: String, val expiresAt: Long)
data class CalendarAccount(val email: String, val accessToken: String, val refreshToken: String, val expiresAt: Long)