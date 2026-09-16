package com.sebas.mikuai.worker

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.sebas.mikuai.MainActivity
import com.sebas.mikuai.MikuApp
import com.sebas.mikuai.R
import com.sebas.mikuai.data.MarkerParser
import com.sebas.mikuai.data.MikuRepository
import com.sebas.mikuai.data.Prompts
import com.sebas.mikuai.data.SecurePrefs

class MikuNotificationWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val prefs   = SecurePrefs(applicationContext)
        val ghToken = prefs.getGitHubToken() ?: return Result.success()
        val orKey   = prefs.getOpenRouterKey() ?: return Result.success()

        return try {
            val repo   = MikuRepository(ghToken, orKey)
            val memory = repo.loadMemory()
            val prompt = Prompts.buildIdlePrompt(memory)

            val raw   = repo.chat(prompt, emptyList(), "¿Tienes algo que decirme?")
            val clean = MarkerParser.parse(raw).cleanText

            // Si no es SILENCIO y tiene contenido real, notificar
            if (clean.isNotBlank() && !clean.uppercase().contains("SILENCIO")) {
                prefs.setPendingNotificationMessage(clean)
                showNotification(clean)
            }

            Result.success()
        } catch (e: Exception) {
            // Fallos de red son normales — no reintentar para no gastar cuota
            Result.success()
        }
    }

    private fun showNotification(message: String) {
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(applicationContext, MikuApp.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Miku")
            .setContentText(message.take(80))
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        manager.notify(System.currentTimeMillis().toInt(), notification)
    }
}