package com.sebas.mikuai.wakeword

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.content.ContextCompat
import com.sebas.mikuai.MainActivity

/**
 * Ficha de Ajustes Rápidos para prender/apagar "Hey Miku" sin abrir la
 * app -- mismo interruptor que el de ⚙️ Configuración en el chat
 * (WakeWordPrefs + WakeWordService), expuesto también acá porque una
 * escucha permanente en segundo plano es exactamente el tipo de cosa que
 * conviene poder cortar rápido (por batería, por privacidad en el
 * momento) sin tener que entrar a la app.
 */
class WakeWordTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        refresh()
    }

    override fun onClick() {
        super.onClick()

        val hasPermission = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

        if (!hasPermission) {
            // No se puede pedir un permiso runtime desde una ficha de QS --
            // se manda a la app para que lo pida ahí (ver ChatScreen.kt).
            val intent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startActivityAndCollapse(
                    android.app.PendingIntent.getActivity(
                        this, 0, intent,
                        android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                    )
                )
            } else {
                @Suppress("DEPRECATION")
                startActivityAndCollapse(intent)
            }
            return
        }

        val enabled = WakeWordPrefs.isEnabled(this)
        if (enabled) {
            WakeWordPrefs.setEnabled(this, false)
            WakeWordService.stop(this)
        } else {
            WakeWordPrefs.setEnabled(this, true)
            WakeWordService.start(this)
        }
        refresh()
    }

    private fun refresh() {
        val tile = qsTile ?: return
        val hasPermission = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        val enabled = hasPermission && WakeWordPrefs.isEnabled(this)

        tile.state = if (enabled) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = "Hey Miku"
        // Tile.setSubtitle() es API 29+ -- minSdk de la app es 26.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = if (!hasPermission) "Falta permiso de micrófono" else if (enabled) "Escuchando" else "Apagado"
        }
        tile.updateTile()
    }
}
