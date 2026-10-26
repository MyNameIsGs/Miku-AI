package com.sebas.mikuai.wakeword

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.sebas.mikuai.MainActivity
import com.sebas.mikuai.MikuApp
import com.sebas.mikuai.R
import com.sebas.mikuai.data.Recordatorios

/**
 * Suena un recordatorio (ver Recordatorios.kt): siempre deja una
 * notificación -- así llega aunque "Hey Miku" esté apagado -- y, si el
 * servicio de "Hey Miku" está prendido, además Miku lo dice en voz alta,
 * como en desktop.
 */
class RecordatorioReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getIntExtra(Recordatorios.EXTRA_ID, -1)
        val mensaje = Recordatorios.take(context, id) ?: return

        val open = PendingIntent.getActivity(
            context, id, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, MikuApp.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_miku)
            .setContentTitle("Recordatorio de Miku")
            .setContentText(mensaje)
            .setStyle(NotificationCompat.BigTextStyle().bigText(mensaje))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            context.getSystemService(NotificationManager::class.java).notify(id, notification)
        } catch (e: SecurityException) {
            // sin permiso de notificaciones: queda solo la voz
        }

        if (WakeWordPrefs.isEnabled(context)) {
            try {
                context.startService(
                    Intent(context, WakeWordService::class.java)
                        .setAction(WakeWordService.ACTION_REMINDER)
                        .putExtra(WakeWordService.EXTRA_REMINDER_TEXT, mensaje)
                )
            } catch (e: Exception) {
                // el servicio no está corriendo y Android no deja arrancarlo
                // desde acá: alcanza con la notificación
            }
        }
    }
}
