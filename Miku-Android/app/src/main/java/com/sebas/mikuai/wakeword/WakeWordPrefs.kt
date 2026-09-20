package com.sebas.mikuai.wakeword

import android.content.Context

/**
 * Preferencia simple (SharedPreferences normal, no encriptada -- es solo
 * un interruptor, no un secreto) para saber si "Hey Miku" debe estar
 * escuchando. La lee BootReceiver para decidir si relanzar el servicio
 * tras un reinicio del teléfono.
 */
object WakeWordPrefs {
    private const val PREFS_NAME = "miku_wakeword_prefs"
    private const val KEY_ENABLED = "enabled"

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_ENABLED, enabled)
            .apply()
    }
}
