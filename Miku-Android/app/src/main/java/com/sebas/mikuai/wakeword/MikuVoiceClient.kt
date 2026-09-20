package com.sebas.mikuai.wakeword

import android.content.Context
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.util.Base64
import com.sebas.mikuai.data.SecurePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * La voz real de Miku (Edge-TTS + RVC) solo existe en el servidor de voz
 * de desktop (`voice_server.py`, GPU-bound) -- no tiene sentido intentar
 * correr eso en un teléfono. En vez de resignarse a una voz genérica
 * siempre, este cliente primero intenta pedirle la voz real a ESE MISMO
 * servidor por la red local (mismo endpoint `/speak` que ya usa el
 * frontend de escritorio, ver `useSpeech.ts`), y si no lo alcanza (la PC
 * apagada, fuera de la red, servidor viejo sin `/lan-key`, timeout, lo que
 * sea) cae en silencio al `TextToSpeech` del sistema -- degradación
 * elegante, nunca un error visible por esto.
 *
 * El servidor exige un header `X-Miku-Key` para pedidos que no vienen de
 * localhost (ver `_restrict_lan_access` en voice_server.py) -- host y
 * clave se configuran una vez en ⚙️ Configuración, copiados del panel de
 * Configuración de la app de escritorio.
 */
class MikuVoiceClient(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private var systemTts: TextToSpeech? = null
    @Volatile private var systemTtsReady = false

    init {
        systemTts = TextToSpeech(context) { status ->
            systemTtsReady = status == TextToSpeech.SUCCESS
            if (systemTtsReady) {
                systemTts?.language = Locale("es", "ES")
            }
        }
    }

    /** Habla `text` con la voz real de Miku si el servidor de desktop responde, si no con la voz del sistema. No hace nada si está muteado. */
    suspend fun speak(text: String) {
        if (text.isBlank()) return
        val prefs = SecurePrefs(context)
        if (prefs.isVoiceMuted()) return

        val playedRealVoice = tryRealVoice(text, prefs)
        if (!playedRealVoice) {
            speakWithSystemVoice(text)
        }
    }

    private suspend fun tryRealVoice(text: String, prefs: SecurePrefs): Boolean {
        val host = prefs.getVoiceServerHost()?.trim()
        val key = prefs.getVoiceServerKey()?.trim()
        if (host.isNullOrEmpty() || key.isNullOrEmpty()) return false

        val audioBase64 = withContext(Dispatchers.IO) {
            try {
                val payload = JSONObject().apply {
                    put("text", text)
                    put("pitch", 10)
                    put("tts_rate", 15)
                }
                val body = payload.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("http://$host/speak")
                    .addHeader("X-Miku-Key", key)
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@withContext null
                    val json = JSONObject(response.body?.string() ?: return@withContext null)
                    json.optString("audio", "").ifEmpty { null }
                }
            } catch (e: Exception) {
                null
            }
        } ?: return false

        return try {
            playBase64Wav(audioBase64)
            true
        } catch (e: Exception) {
            false
        }
    }

    private suspend fun playBase64Wav(base64: String) = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine<Unit> { cont ->
            var tempFile: File? = null
            try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val file = File.createTempFile("miku_voice_", ".wav", context.cacheDir)
                tempFile = file
                file.writeBytes(bytes)

                val player = MediaPlayer()
                fun finish() {
                    try { player.release() } catch (e: Exception) {}
                    file.delete()
                    if (cont.isActive) cont.resume(Unit)
                }
                player.setOnCompletionListener { finish() }
                player.setOnErrorListener { _, _, _ -> finish(); true }
                player.setDataSource(file.absolutePath)
                player.prepare()
                player.start()

                cont.invokeOnCancellation {
                    try { player.release() } catch (e: Exception) {}
                    tempFile?.delete()
                }
            } catch (e: Exception) {
                tempFile?.delete()
                if (cont.isActive) cont.resume(Unit)
            }
        }
    }

    private fun speakWithSystemVoice(text: String) {
        if (!systemTtsReady) return
        systemTts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "miku_voice_reply")
    }

    fun shutdown() {
        systemTts?.shutdown()
    }

    companion object {
        // Cliente HTTP liviano y estático, separado del de la instancia --
        // el botón "Probar conexión" de ⚙️ Configuración no necesita (ni
        // debería pagar el costo de) levantar un TextToSpeech del sistema
        // solo para chequear si el servidor responde.
        private val healthCheckClient = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(4, TimeUnit.SECONDS)
            .build()

        /** Para el botón "Probar conexión" -- pega /health en vez de disparar una síntesis de voz completa. */
        suspend fun checkConnection(host: String, key: String): Boolean = withContext(Dispatchers.IO) {
            try {
                val request = Request.Builder()
                    .url("http://$host/health")
                    .addHeader("X-Miku-Key", key)
                    .get()
                    .build()
                healthCheckClient.newCall(request).execute().use { it.isSuccessful }
            } catch (e: Exception) {
                false
            }
        }
    }
}
