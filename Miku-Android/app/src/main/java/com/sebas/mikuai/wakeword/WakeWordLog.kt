package com.sebas.mikuai.wakeword

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Registro de detecciones de "Hey Miku" (2026-09-28), el mismo que desktop
 * (voice_server.py, WAKE_WORD_LOG_DIR): por cada detección, y por cada roce
 * que no llegó a confirmarse, guarda el audio de los ~2,5 s previos (.wav)
 * y el score cuadro a cuadro (.json) en filesDir/wake-word-log/. Sirve para
 * calibrar los falsos positivos con audio del propio celular midiendo, no a
 * ciegas. Se lee por USB:
 *   adb shell run-as com.sebas.mikuai ls files/wake-word-log
 * (el logcat del Redmagic está silenciado, log.tag=S).
 */
class WakeWordLog(context: Context, private val sampleRate: Int) {

    private val dir = File(context.filesDir, "wake-word-log")
    private val frames = ArrayDeque<ShortArray>(MAX_FRAMES)
    private val scores = ArrayDeque<Float>(MAX_FRAMES)

    /** Una línea suelta (qué fuente de audio se usó, si hay cancelador de eco). */
    fun note(line: String) {
        thread(name = "miku-wakeword-log") {
            try {
                dir.mkdirs()
                File(dir, "notas.txt").appendText("${stamp()} $line\n")
            } catch (e: Exception) {
            }
        }
    }

    fun add(chunk: ShortArray, score: Float) {
        if (frames.size == MAX_FRAMES) {
            frames.removeFirst()
            scores.removeFirst()
        }
        frames.addLast(chunk.copyOf())
        scores.addLast(score)
    }

    fun clear() {
        frames.clear()
        scores.clear()
    }

    /** Guarda lo acumulado. `accepted` = disparó; si no, fue un roce descartado. */
    fun save(accepted: Boolean, threshold: Float, confirmFrames: Int, source: String) {
        val audio = frames.toList()
        val trace = scores.toList()
        val name = stamp() + if (accepted) "" else "-rechazada"
        thread(name = "miku-wakeword-log") {
            try {
                dir.mkdirs()
                writeWav(File(dir, "$name.wav"), audio)
                val json = JSONObject().apply {
                    put("accepted", accepted)
                    put("threshold", threshold.toDouble())
                    put("confirm_frames", confirmFrames)
                    put("source", source)
                    put("scores", JSONArray(trace.map { Math.round(it * 10000) / 10000.0 }))
                }
                File(dir, "$name.json").writeText(json.toString())
                prune()
            } catch (e: Exception) {
            }
        }
    }

    private fun writeWav(file: File, audio: List<ShortArray>) {
        val samples = audio.sumOf { it.size }
        val dataBytes = samples * 2
        RandomAccessFile(file, "rw").use { out ->
            out.setLength(0)
            val header = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN).apply {
                put("RIFF".toByteArray()); putInt(36 + dataBytes); put("WAVE".toByteArray())
                put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
                putInt(sampleRate); putInt(sampleRate * 2); putShort(2); putShort(16)
                put("data".toByteArray()); putInt(dataBytes)
            }
            out.write(header.array())
            val body = java.nio.ByteBuffer.allocate(dataBytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            audio.forEach { chunk -> chunk.forEach { body.putShort(it) } }
            out.write(body.array())
        }
    }

    // Que el registro no crezca sin límite en el celular: quedan las últimas MAX_FILES detecciones.
    private fun prune() {
        val entries = dir.listFiles { f -> f.name.endsWith(".json") }?.sortedBy { it.name } ?: return
        entries.dropLast(MAX_FILES).forEach { json ->
            json.delete()
            File(dir, json.name.removeSuffix(".json") + ".wav").delete()
        }
    }

    private fun stamp() = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

    companion object {
        private const val MAX_FRAMES = 31 // ~2,5 s de cuadros de 80 ms
        private const val MAX_FILES = 200
    }
}
