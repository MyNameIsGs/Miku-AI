package com.sebas.mikuai

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class MikuApp : Application() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Miku",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Mensajes de Miku"
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "miku_channel"
    }
}