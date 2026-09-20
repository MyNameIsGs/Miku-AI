package com.sebas.mikuai.wakeword

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Relanza el servicio de "Hey Miku" después de un reinicio del teléfono,
 * si estaba activado antes de apagarse -- para que sea un asistente que
 * de verdad está siempre escuchando, no algo que hay que recordar
 * prender manualmente cada vez. RECEIVE_BOOT_COMPLETED ya estaba
 * declarado en el manifest (lo usa WorkManager); este receiver es nuevo.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (WakeWordPrefs.isEnabled(context)) {
            WakeWordService.start(context)
        }
    }
}
