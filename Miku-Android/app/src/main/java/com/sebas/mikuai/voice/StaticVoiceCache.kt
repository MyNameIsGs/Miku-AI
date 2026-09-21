package com.sebas.mikuai.voice

import android.content.Context
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.security.MessageDigest

/**
 * Cachea el audio ya sintetizado de las pocas frases ESTÁTICAS del wake-word
 * (errores/avisos fijos como "no tengo credenciales" o "no pude entenderte",
 * siempre el mismo texto) -- evita pagar los ~9s del pipeline RVC completo
 * cada vez que hace falta la MISMA frase de siempre. Nunca se usa para
 * respuestas reales generadas por el LLM (son distintas cada vez, cachearlas
 * no serviría de nada).
 *
 * La clave de archivo incluye un hash corto del texto: si el string de
 * recurso cambia alguna vez, el cache se invalida solo (el archivo viejo
 * queda huérfano y lo limpia [ModelDownloadManager]... salvo que este vive
 * en su propia carpeta, así que un huérfano acá simplemente no se vuelve a
 * leer -- no vale la pena la complejidad de limpiarlo también, son unos
 * pocos KB por frase).
 */
object StaticVoiceCache {

    private fun dir(context: Context): File =
        File(context.filesDir, "static-voice-cache").apply { mkdirs() }

    private fun fileFor(context: Context, key: String, text: String): File {
        val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray())
        val shortHash = digest.joinToString("") { "%02x".format(it) }.take(12)
        return File(dir(context), "${key}_$shortHash.pcm")
    }

    /** PCM mono float32, mismo formato que espera [AudioPlayer.play]. Null si no está cacheado (o el archivo está corrupto). */
    fun load(context: Context, key: String, text: String): FloatArray? {
        val file = fileFor(context, key, text)
        if (!file.exists()) return null
        return try {
            DataInputStream(file.inputStream().buffered()).use { input ->
                val count = (file.length() / 4).toInt()
                FloatArray(count) { input.readFloat() }
            }
        } catch (e: Exception) {
            file.delete()
            null
        }
    }

    fun save(context: Context, key: String, text: String, pcm: FloatArray) {
        val file = fileFor(context, key, text)
        try {
            DataOutputStream(file.outputStream().buffered()).use { output ->
                for (sample in pcm) output.writeFloat(sample)
            }
        } catch (e: Exception) {
            file.delete()
        }
    }
}
