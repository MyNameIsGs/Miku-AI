package com.sebas.mikuai.wakeword

import android.Manifest
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
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
            val views = RemoteViews(context.packageName, R.layout.widget_miku)
            views.setOnClickPendingIntent(R.id.widget_miku_root, buildPendingIntent(context))
            appWidgetManager.updateAppWidget(appWidgetId, views)
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
