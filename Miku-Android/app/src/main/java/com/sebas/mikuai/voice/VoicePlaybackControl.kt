package com.sebas.mikuai.voice

import android.speech.tts.TextToSpeech

/**
 * Punto único para cortar la voz de Miku a mitad de reproducción (idea
 * #12) -- lo usa el botón de cerrar de la pantalla flotante. Cubre los dos
 * caminos posibles de audio del wake-word: el pipeline RVC ([AudioPlayer],
 * PCM crudo) y el `TextToSpeech` del sistema (respaldo). `WakeWordService`
 * es quien registra el `TextToSpeech` activo y un callback opcional para
 * reaccionar al corte (reactivar el mic de inmediato en vez de esperar el
 * temporizador estimado) -- nunca suena más de una cosa a la vez, así que
 * un solo campo de cada uno alcanza.
 */
object VoicePlaybackControl {
    @Volatile private var activeTts: TextToSpeech? = null
    @Volatile private var onStopRequested: (() -> Unit)? = null
    @Volatile private var onCancelRequested: (() -> Unit)? = null

    /** Lo registra `WakeWordService`: descarta el pedido de voz en curso. */
    fun registerCancelCallback(callback: (() -> Unit)?) {
        onCancelRequested = callback
    }

    /**
     * Cerrar la pantalla flotante (la X o tocar afuera): corta el audio Y
     * descarta el pedido entero -- si Miku todavía estaba escuchando,
     * pensando o generando la voz, no responde después ni guarda nada.
     * Antes solo cortaba el audio, y las respuestas llegaban igual.
     */
    fun cancelAll() {
        stopCurrent()
        onCancelRequested?.invoke()
    }

    fun registerSystemTts(tts: TextToSpeech?) {
        activeTts = tts
    }

    fun registerStopCallback(callback: (() -> Unit)?) {
        onStopRequested = callback
    }

    fun stopCurrent() {
        AudioPlayer.stop()
        activeTts?.stop()
        onStopRequested?.invoke()
    }
}
