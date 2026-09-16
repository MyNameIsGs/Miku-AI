package com.sebas.mikuai.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

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

    /** Mensaje generado por el job de notificaciones, pendiente de mostrar en el chat. */
    fun getPendingNotificationMessage(): String? = prefs.getString(KEY_PENDING, null)
    fun setPendingNotificationMessage(msg: String) = prefs.edit().putString(KEY_PENDING, msg).apply()
    fun clearPendingNotificationMessage() = prefs.edit().remove(KEY_PENDING).apply()

    fun clearAll() = prefs.edit().clear().apply()

    companion object {
        private const val KEY_GH      = "gh_token"
        private const val KEY_OR      = "or_key"
        private const val KEY_PENDING = "pending_notification"
    }
}