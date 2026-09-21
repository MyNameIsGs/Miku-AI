package com.sebas.mikuai.voice

import android.media.MediaCodec
import android.media.MediaDataSource
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.ByteArrayOutputStream
import kotlin.math.min

/** Resultado de decodificar un MP3: PCM float32 mono en [-1,1] y su sample rate real. */
data class DecodedAudio(val samples: FloatArray, val sampleRate: Int)

/**
 * Decodifica el MP3 que devuelve Edge-TTS (`EdgeTtsClient.synthesize()`) a
 * PCM usando `MediaExtractor`+`MediaCodec` nativos de Android -- no hace
 * falta ninguna librería de MP3 de terceros, el decoder ya viene con el
 * sistema operativo. Se lee de un `MediaDataSource` en memoria (sin archivo
 * temporal); si algún día esto da problemas en el dispositivo real, la
 * alternativa documentada es escribir a un archivo en `cacheDir` y usar
 * `MediaExtractor.setDataSource(path)`, un camino más transitado.
 */
object Mp3Decoder {

    fun decode(mp3Bytes: ByteArray): DecodedAudio {
        val dataSource = ByteArrayMediaDataSource(mp3Bytes)
        val extractor = MediaExtractor()
        extractor.setDataSource(dataSource)

        var trackIndex = -1
        var format: MediaFormat? = null
        for (i in 0 until extractor.trackCount) {
            val f = extractor.getTrackFormat(i)
            val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) {
                trackIndex = i
                format = f
                break
            }
        }
        requireNotNull(format) { "El MP3 de Edge-TTS no tiene pista de audio" }
        extractor.selectTrack(trackIndex)

        val mime = format.getString(MediaFormat.KEY_MIME)!!
        val sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        val channelCount = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()

        val pcm = ByteArrayOutputStream()
        var sawInputEos = false
        var sawOutputEos = false
        val bufferInfo = MediaCodec.BufferInfo()

        try {
            while (!sawOutputEos) {
                if (!sawInputEos) {
                    val inIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                    if (inIndex >= 0) {
                        val inBuffer = codec.getInputBuffer(inIndex)!!
                        val sampleSize = extractor.readSampleData(inBuffer, 0)
                        if (sampleSize < 0) {
                            codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            sawInputEos = true
                        } else {
                            codec.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIndex = codec.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
                if (outIndex >= 0) {
                    if (bufferInfo.size > 0) {
                        val outBuffer = codec.getOutputBuffer(outIndex)!!
                        outBuffer.position(bufferInfo.offset)
                        outBuffer.limit(bufferInfo.offset + bufferInfo.size)
                        val chunk = ByteArray(bufferInfo.size)
                        outBuffer.get(chunk)
                        pcm.write(chunk)
                    }
                    codec.releaseOutputBuffer(outIndex, false)
                    if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        sawOutputEos = true
                    }
                }
            }
        } finally {
            codec.stop()
            codec.release()
            extractor.release()
        }

        val floats = pcm16ToFloatMono(pcm.toByteArray(), channelCount)
        return DecodedAudio(floats, sampleRate)
    }

    /** PCM 16-bit little-endian (posiblemente multi-canal) -> float32 mono [-1,1], promediando canales. */
    private fun pcm16ToFloatMono(bytes: ByteArray, channelCount: Int): FloatArray {
        val bytesPerFrame = 2 * channelCount
        val frameCount = bytes.size / bytesPerFrame
        val out = FloatArray(frameCount)
        var pos = 0
        for (f in 0 until frameCount) {
            var sum = 0
            for (c in 0 until channelCount) {
                val lo = bytes[pos].toInt() and 0xFF
                val hi = bytes[pos + 1].toInt()
                val sample = (hi shl 8) or lo
                sum += sample
                pos += 2
            }
            out[f] = (sum / channelCount.toFloat()) / 32768f
        }
        return out
    }

    private const val TIMEOUT_US = 10_000L

    /** [MediaDataSource] mínimo sobre un `ByteArray` ya en memoria, evita escribir un archivo temporal. */
    private class ByteArrayMediaDataSource(private val data: ByteArray) : MediaDataSource() {
        override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
            if (position >= data.size) return -1
            val length = min(size.toLong(), data.size - position).toInt()
            System.arraycopy(data, position.toInt(), buffer, offset, length)
            return length
        }

        override fun getSize(): Long = data.size.toLong()
        override fun close() {}
    }
}
