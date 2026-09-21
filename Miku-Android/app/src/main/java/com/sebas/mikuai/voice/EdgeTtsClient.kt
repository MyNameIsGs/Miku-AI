package com.sebas.mikuai.voice

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.random.Random

/**
 * Puerto a Kotlin del cliente WebSocket de Edge-TTS (puerto `edge_tts.Communicate`,
 * ver `constants.py`/`communicate.py`/`drm.py` del paquete Python instalado del
 * lado desktop). Se usa SOLO como voz "fuente" para la conversión RVC -- la
 * única dependencia de red que le queda a la voz real de Miku en Android (ver
 * el plan: se comparó por A/B contra un TTS offline y Edge-TTS ganó lejos).
 *
 * No hay SDK oficial de Edge-TTS para Kotlin/JVM; este protocolo no es
 * público ni documentado por Microsoft, así que replica exactamente lo que
 * hace el cliente Python de código abierto (mismo endpoint, mismos headers,
 * mismo cálculo del token `Sec-MS-GEC`).
 */
object EdgeTtsClient {

    private const val TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
    private const val WSS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1"
    private const val CHROMIUM_VERSION = "143.0.3650.75"
    private const val SEC_MS_GEC_VERSION = "1-$CHROMIUM_VERSION"
    private const val WIN_EPOCH_SECONDS = 11_644_473_600L

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    /**
     * Sintetiza [text] con la voz [voice] de Edge-TTS y devuelve el audio MP3
     * crudo (24kHz mono 48kbps CBR, según `outputFormat` pedido). Lanza una
     * excepción si la conexión falla o si no llega audio -- el llamador
     * (`WakeWordService.speak()`) debe atajarla y volver al TextToSpeech del
     * sistema, mismo criterio permisivo que el resto del pipeline de voz.
     */
    suspend fun synthesize(
        text: String,
        voice: String = "es-MX-DaliaNeural",
        rate: String = "+15%",
        pitch: String = "+0Hz",
        volume: String = "+0%",
        timeoutMs: Long = 30_000,
    ): ByteArray = withTimeout(timeoutMs) {
        suspendCancellableCoroutine { cont ->
            val requestId = uuidNoDashes()
            val connectionId = uuidNoDashes()
            val url = "$WSS_URL?TrustedClientToken=$TRUSTED_CLIENT_TOKEN" +
                "&ConnectionId=$connectionId" +
                "&Sec-MS-GEC=${generateSecMsGec()}" +
                "&Sec-MS-GEC-Version=$SEC_MS_GEC_VERSION"

            val request = Request.Builder()
                .url(url)
                .addHeader("Pragma", "no-cache")
                .addHeader("Cache-Control", "no-cache")
                .addHeader("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
                .addHeader(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                        "(KHTML, like Gecko) Chrome/$CHROMIUM_VERSION Safari/537.36 Edg/$CHROMIUM_VERSION"
                )
                .addHeader("Accept-Language", "en-US,en;q=0.9")
                .addHeader("Cookie", "muid=${randomMuid()};")
                .build()

            val audioBuffer = ByteArrayOutputStream()
            var finished = false

            val listener = object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(buildSpeechConfigMessage())
                    webSocket.send(buildSsmlMessage(requestId, voice, rate, pitch, volume, text))
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val path = extractPath(text) ?: return
                    if (path == "turn.end") {
                        finished = true
                        webSocket.close(1000, null)
                        if (cont.isActive) {
                            if (audioBuffer.size() > 0) {
                                cont.resume(audioBuffer.toByteArray())
                            } else {
                                cont.resumeWithException(IllegalStateException("Edge-TTS no devolvió audio"))
                            }
                        }
                    }
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    // Layout confirmado empíricamente contra el servidor real (no solo
                    // leído del código Python): los primeros 2 bytes son el offset (NO
                    // el largo) hasta el final del bloque de headers, medido desde el
                    // inicio del mensaje -- es decir, el texto de headers en sí vive en
                    // data[2 until headerLength], seguido de un "\r\n" y recién ahí el
                    // payload de audio, en data[headerLength+2..].
                    val data = bytes.toByteArray()
                    if (data.size < 2) return
                    val headerLength = ((data[0].toInt() and 0xFF) shl 8) or (data[1].toInt() and 0xFF)
                    if (headerLength > data.size || headerLength < 2) return
                    val headerText = String(data, 2, headerLength - 2, Charsets.UTF_8)
                    if (!headerText.contains("Path:audio")) return
                    val payloadStart = headerLength + 2
                    if (payloadStart < data.size) {
                        audioBuffer.write(data, payloadStart, data.size - payloadStart)
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (!finished && cont.isActive) cont.resumeWithException(t)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (!finished && cont.isActive) {
                        if (audioBuffer.size() > 0) {
                            cont.resume(audioBuffer.toByteArray())
                        } else {
                            cont.resumeWithException(IllegalStateException("Edge-TTS cerró la conexión sin audio"))
                        }
                    }
                }
            }

            val ws = client.newWebSocket(request, listener)
            cont.invokeOnCancellation { ws.cancel() }
        }
    }

    // ---- Construcción de los frames del protocolo ----

    private fun buildSpeechConfigMessage(): String {
        val timestamp = jsDateString()
        return "X-Timestamp:$timestamp\r\n" +
            "Content-Type:application/json; charset=utf-8\r\n" +
            "Path:speech.config\r\n\r\n" +
            "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{" +
            "\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"}," +
            "\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}\r\n"
    }

    private fun buildSsmlMessage(requestId: String, voice: String, rate: String, pitch: String, volume: String, text: String): String {
        val timestamp = jsDateString()
        val escaped = escapeXml(cleanText(text))
        val ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
            "<voice name='$voice'>" +
            "<prosody pitch='$pitch' rate='$rate' volume='$volume'>" +
            escaped +
            "</prosody></voice></speak>"
        return "X-RequestId:$requestId\r\n" +
            "Content-Type:application/ssml+xml\r\n" +
            "X-Timestamp:${timestamp}Z\r\n" +
            "Path:ssml\r\n\r\n" +
            ssml
    }

    private fun extractPath(text: String): String? {
        val headerEnd = text.indexOf("\r\n\r\n")
        val headerBlock = if (headerEnd >= 0) text.substring(0, headerEnd) else text
        for (line in headerBlock.split("\r\n")) {
            val idx = line.indexOf(':')
            if (idx > 0 && line.substring(0, idx).equals("Path", ignoreCase = true)) {
                return line.substring(idx + 1)
            }
        }
        return null
    }

    // ---- Sec-MS-GEC ----

    /**
     * Token anti-bot de Microsoft: timestamp UTC + epoch de Windows,
     * redondeado hacia abajo a múltiplo de 300s, convertido a ticks de 100ns,
     * concatenado con el token público y hasheado con SHA-256. Ver `drm.py`.
     */
    private fun generateSecMsGec(): String {
        val nowSeconds = System.currentTimeMillis() / 1000L
        var ticks = nowSeconds + WIN_EPOCH_SECONDS
        ticks -= ticks % 300
        val ticks100ns = ticks * 10_000_000L
        val strToHash = "$ticks100ns$TRUSTED_CLIENT_TOKEN"
        return sha256Hex(strToHash).uppercase(Locale.ROOT)
    }

    private fun sha256Hex(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.US_ASCII))
        val sb = StringBuilder(digest.size * 2)
        for (b in digest) sb.append(String.format(Locale.ROOT, "%02x", b))
        return sb.toString()
    }

    private fun randomMuid(): String {
        val bytes = ByteArray(16)
        Random.nextBytes(bytes)
        val sb = StringBuilder(32)
        for (b in bytes) sb.append(String.format(Locale.ROOT, "%02X", b))
        return sb.toString()
    }

    private fun uuidNoDashes(): String = UUID.randomUUID().toString().replace("-", "")

    private fun jsDateString(): String {
        val fmt = SimpleDateFormat("EEE MMM dd yyyy HH:mm:ss", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return "${fmt.format(java.util.Date())} GMT+0000 (Coordinated Universal Time)"
    }

    /** Reemplaza caracteres de control no soportados por el servicio (mismo rango que `remove_incompatible_characters`). */
    private fun cleanText(text: String): String {
        val chars = text.toCharArray()
        for (i in chars.indices) {
            val code = chars[i].code
            if (code in 0..8 || code in 11..12 || code in 14..31) chars[i] = ' '
        }
        return String(chars)
    }

    private fun escapeXml(text: String): String =
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
