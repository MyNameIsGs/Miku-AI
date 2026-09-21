package com.sebas.mikuai.wakeword

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.sebas.mikuai.ui.theme.MikuTheme
import com.sebas.mikuai.voice.VoicePlaybackControl

/**
 * Pantalla flotante que se muestra al decir "Hey Miku" (estilo "Hey
 * Gemini") -- camino de RESPALDO para cuando el usuario no dio el permiso
 * de "superponerse a otras apps" (ver `MikuOverlayWindow`, el camino
 * principal, una ventana de overlay de verdad que aparece al instante
 * siempre). Esta Activity se dispara vía una notificación de pantalla
 * completa (`setFullScreenIntent`): Android SOLO la abre sola cuando el
 * teléfono está bloqueado -- con la pantalla desbloqueada y en uso,
 * a propósito se queda como notificación normal que hay que tocar (así
 * evita que apps usen esto como "publicidad a pantalla completa"), no hay
 * forma de saltear eso sin el permiso de superposición.
 *
 * Dibuja el estado compartido en [MikuOverlayState] -- no hace ningún
 * trabajo real, eso lo sigue haciendo el service.
 */
class MikuOverlayActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // El wake-word sirve justo para el caso de teléfono bloqueado en el
        // bolsillo -- sin esto, la pantalla flotante nunca se vería ahí (se
        // quedaría solo como notificación en la pantalla de bloqueo). Esto
        // NO desbloquea el teléfono ni evita la contraseña -- dibuja arriba
        // del keyguard, igual que la pantalla de una llamada entrante.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }

        // La notificación de pantalla completa ya cumplió su función (lanzar
        // esta Activity) -- cancelarla para que no quede colgada en la
        // bandeja de notificaciones.
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager)
                ?.cancel(WakeWordService.OVERLAY_NOTIFICATION_ID)
        } catch (e: Exception) {
        }

        setContent {
            MikuTheme {
                val phase by MikuOverlayState.phase.collectAsState()

                // Se cierra sola cuando el service marca que ya terminó
                // (audio reproducido del todo, o TTS del sistema con el
                // tiempo estimado ya transcurrido).
                LaunchedEffect(phase) {
                    if (phase is MikuOverlayPhase.Idle) finish()
                }

                // Idea #12: cerrar la tarjeta también corta el audio en
                // curso -- antes solo se escondía la UI y Miku seguía
                // hablando sola desde el bolsillo.
                OverlayScreen(
                    phase = phase,
                    onDismiss = {
                        VoicePlaybackControl.stopCurrent()
                        finish()
                    },
                )
            }
        }
    }
}
