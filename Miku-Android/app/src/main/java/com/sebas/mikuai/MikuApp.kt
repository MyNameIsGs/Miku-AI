package com.sebas.mikuai

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class MikuApp : Application() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        val manager = getSystemService(NotificationManager::class.java)

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Miku",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Mensajes de Miku"
        }
        manager.createNotificationChannel(channel)

        // Canal aparte, silencioso, para la notificación persistente del
        // servicio en primer plano de "Hey Miku" (wakeword/WakeWordService.kt)
        // -- Android exige una notificación visible mientras el servicio
        // escucha, pero no tiene sentido que suene cada vez que cambia de
        // "escuchando" a "pensando".
        val wakeWordChannel = NotificationChannel(
            WAKEWORD_CHANNEL_ID,
            "Hey Miku (escucha activa)",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Estado del wake-word \"Hey Miku\""
            setShowBadge(false)
        }
        manager.createNotificationChannel(wakeWordChannel)
    }

    companion object {
        const val CHANNEL_ID = "miku_channel"
        const val WAKEWORD_CHANNEL_ID = "miku_wakeword_channel"
    }
}