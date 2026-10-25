package com.sebas.mikuai.wakeword

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.Normalizer
import java.util.concurrent.TimeUnit

/**
 * Segunda revisión de "Hey Miku" (2026-10-25), la misma que hace desktop
 * con Whisper (voice_server.py, WAKE_WORD_VERIFY_PATTERN): el detector
 * nanowakeword pasa el umbral con casi cualquier voz -- las 7 activaciones
 * guardadas en el celular eran todas falsas ("¡Suscríbete al canal!",
 * "Gracias.", un video de cocina). Antes de despertar a Miku se transcribe
 * el audio de la detección y solo se acepta si dice el llamado.
 *
 * Se transcribe en la nube (OpenRouter, mismo Whisper large-v3-turbo que
 * corre desktop en la GPU) porque nada que corra EN el teléfono sirvió,
 * medido con audios reales: Vosk 1/4 "Hey Miku" y 51 falsos; Whisper
 * tiny/base/small 0-1 de 5 ("meco", "me cucho"); el reconocedor on-device
 * de Google ignora EXTRA_AUDIO_SOURCE y el de Servicios de voz da NO_MATCH
 * con una frase tan corta. Con este: 4/5 reales, 0/51 falsos, ~1,2 s y
 * ~0,00003 USD por revisión (por eso WakeWordService escucha el pedido
 * mientras tanto, ver onWakeCandidate).
 *
 * Sin clave, sin red o con error, se acepta igual -- mismo criterio que
 * desktop si Whisper no cargó: nunca peor que antes.
 */
class WakeWordVerifier(private val apiKey: String) {

    data class Result(val accepted: Boolean, val heard: String?, val checked: Boolean)

    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    suspend fun verify(pcm: ShortArray, sampleRate: Int): Result = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().apply {
                put("model", MODEL)
                put("language", "es")
                put("input_audio", JSONObject().apply {
                    put("data", Base64.encodeToString(wav(pcm, sampleRate), Base64.NO_WRAP))
                    put("format", "wav")
                })
            }.toString().toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url(URL)
                .addHeader("Authorization", "Bearer $apiKey")
                .addHeader("HTTP-Referer", REFERER)
                .post(body)
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext Result(true, null, checked = false)
                val heard = JSONObject(response.body!!.string()).optString("text").trim()
                Result(isWakePhrase(heard), heard, checked = true)
            }
        } catch (e: Exception) {
            Result(true, null, checked = false)
        }
    }

    private fun wav(pcm: ShortArray, sampleRate: Int): ByteArray {
        val dataBytes = pcm.size * 2
        return ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + dataBytes); put("WAVE".toByteArray())
            put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
            putInt(sampleRate); putInt(sampleRate * 2); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(dataBytes)
            pcm.forEach { putShort(it) }
        }.array()
    }

    companion object {
        private const val URL = "https://openrouter.ai/api/v1/audio/transcriptions"
        private const val MODEL = "openai/whisper-large-v3-turbo"
        private const val REFERER = "https://github.com/MyNameIsGs/Miku-AI"

        // Misma regla que WAKE_WORD_VERIFY_PATTERN de desktop, más la "g":
        // en la nube, el "Ehi Miku" de Sebastián salió dos veces como "Ey, migo".
        private val PATTERN = Regex("(?:^|[^a-z])(?:h?e+h?[iy]*|oye)\\W*m\\s*[iy]\\s*[kcqg]+\\s*[uo]\\b")

        fun isWakePhrase(text: String): Boolean {
            val plain = Normalizer.normalize(text.lowercase(), Normalizer.Form.NFD)
                .replace(Regex("\\p{Mn}+"), "")
            return PATTERN.containsMatchIn(plain)
        }
    }
}
