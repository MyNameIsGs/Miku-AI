package com.sebas.mikuai.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack

/**
 * Wrapper fino sobre `AudioTrack` para reproducir el PCM float32 que produce
 * [RvcPipeline] directamente, sin pasar por un archivo WAV intermedio (eso
 * solo hacía falta del lado desktop, que guarda a disco).
 */
object AudioPlayer {

    // Idea #12: cortar el audio de verdad a mitad de reproducción, no solo
    // esconder la pantalla flotante. `stop()` puede llamarse desde
    // cualquier hilo (el botón de cerrar corre en el hilo de UI) -- en vez
    // de tocar el AudioTrack directamente desde ahí (riesgo real de
    // concurrencia, por eso esta idea se había dejado afuera del Paso 5),
    // solo prende una bandera que el propio hilo que reproduce revisa cada
    // 50ms y actúa en consecuencia -- el AudioTrack nunca lo toca más de un
    // hilo a la vez.
    @Volatile private var stopRequested = false

    /** Reproduce [pcm] (mono, float32 en [-1,1]) a [sampleRate] Hz y bloquea hasta que termina (o se pide [stop]). */
    fun play(pcm: FloatArray, sampleRate: Int) {
        if (pcm.isEmpty()) return
        stopRequested = false

        val minBufferSize = AudioTrack.getMinBufferSize(
            sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT
        )
        val bufferSize = maxOf(minBufferSize, pcm.size * 4)

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()

        try {
            track.write(pcm, 0, pcm.size, AudioTrack.WRITE_BLOCKING)
            track.play()
            val durationMs = (pcm.size.toLong() * 1000 / sampleRate) + 200
            val stepMs = 50L
            var elapsed = 0L
            while (elapsed < durationMs && !stopRequested) {
                Thread.sleep(stepMs)
                elapsed += stepMs
            }
        } finally {
            track.stop()
            track.release()
        }
    }

    /** Corta el audio actual, si hay alguno sonando (no-op si no hay nada reproduciéndose). */
    fun stop() {
        stopRequested = true
    }
}
