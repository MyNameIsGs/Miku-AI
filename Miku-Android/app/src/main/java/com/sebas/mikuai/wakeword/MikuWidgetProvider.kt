package com.sebas.mikuai.wakeword

import android.Manifest
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import com.sebas.mikuai.MainActivity
import com.sebas.mikuai.R

/**
 * Idea #6: widget de pantalla de inicio con un botón "Hablar con Miku" --
 * dispara el mismo camino que detectar "Hey Miku" (ver
 * WakeWordService.quickListen), sin tener que decir la palabra de
 * activación en voz alta. Pensado para cuando eso no es cómodo (reunión,
 * lugar público) pero abrir la app entera y esperar tampoco sirve porque
 * se busca algo rápido.
 *
 * Sin estado propio que mostrar (a diferencia de la ficha de Ajustes
 * Rápidos, que sí refleja si "Hey Miku" está prendido) -- es un botón
 * fijo, se actualiza solo si Android lo pide (`onUpdate`).
 */
class MikuWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (appWidgetId in appWidgetIds) {
            appWidgetManager.updateAppWidget(appWidgetId, buildViews(context))
        }
    }

    // Ronda 2 de diseño (DISENO.md §6.6): con «Hey Miku» apagado, borde
    // gris, cebollín al 70 %, micrófono con contorno y la aclaración de que
    // tocarlo lo prende.
    private fun buildViews(context: Context): RemoteViews {
        val enabled = WakeWordPrefs.isEnabled(context)
        return RemoteViews(context.packageName, R.layout.widget_miku).apply {
            setInt(
                R.id.widget_miku_root,
                "setBackgroundResource",
                if (enabled) R.drawable.widget_miku_background else R.drawable.widget_miku_background_off,
            )
            setInt(R.id.widget_miku_avatar, "setImageAlpha", if (enabled) 255 else 178)
            setTextViewText(R.id.widget_miku_status, if (enabled) "«HEY MIKU» ACTIVO" else "TOCAR PRENDE «HEY MIKU»")
            setTextColor(R.id.widget_miku_status, if (enabled) 0xFF39C5BB.toInt() else 0xFF7E9B98.toInt())
            setInt(
                R.id.widget_miku_mic,
                "setBackgroundResource",
                if (enabled) R.drawable.widget_mic_background else R.drawable.widget_mic_background_off,
            )
            setImageViewResource(R.id.widget_miku_mic, if (enabled) R.drawable.ic_widget_mic else R.drawable.ic_widget_mic_off)
            setOnClickPendingIntent(R.id.widget_miku_root, buildPendingIntent(context))
        }
    }

    companion object {
        /** Redibuja los widgets (al prender o apagar «Hey Miku»). */
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, MikuWidgetProvider::class.java))
            if (ids.isNotEmpty()) {
                MikuWidgetProvider().onUpdate(context, manager, ids)
            }
        }
    }

    private fun buildPendingIntent(context: Context): PendingIntent {
        val hasMicPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED

        // Sin permiso de micrófono no hay nada que escuchar -- un widget
        // no puede pedir un permiso runtime, así que manda a la app para
        // que lo pida ahí (mismo criterio que WakeWordTileService).
        if (!hasMicPermission) {
            val openApp = Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(
                context,
                0,
                openApp,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val quickListen = Intent(context, WakeWordService::class.java)
            .setAction(WakeWordService.ACTION_QUICK_LISTEN)
        return PendingIntent.getForegroundService(
            context,
            0,
            quickListen,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
