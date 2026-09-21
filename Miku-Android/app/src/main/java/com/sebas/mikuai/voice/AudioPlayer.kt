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

    /** Reproduce [pcm] (mono, float32 en [-1,1]) a [sampleRate] Hz y bloquea hasta que termina. */
    fun play(pcm: FloatArray, sampleRate: Int) {
        if (pcm.isEmpty()) return

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
            Thread.sleep(durationMs)
        } finally {
            track.stop()
            track.release()
        }
    }
}
