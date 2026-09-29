package com.sebas.mikuai.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File

/**
 * "Compartir con Miku" (2026-09-28): desde otra app (navegador, YouTube,
 * galería) Compartir → Miku abre el chat con el texto o el link ya escrito
 * en el campo y la foto adjunta, para que Sebastián agregue lo que quiera
 * antes de enviar. MainActivity recibe el Intent y lo deja acá; ChatScreen
 * lo toma una vez.
 */
data class SharedContent(val text: String?, val imageUri: Uri?)

object SharedIntake {
    private val _pending = MutableStateFlow<SharedContent?>(null)
    val pending: StateFlow<SharedContent?> = _pending

    /** true si el Intent era un "compartir" (texto o imagen) y se tomó. */
    fun offer(context: Context, intent: Intent?): Boolean {
        if (intent?.action != Intent.ACTION_SEND) return false
        val type = intent.type.orEmpty()
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            ?.let { if (!subject.isNullOrBlank() && !it.contains(subject)) "$subject\n$it" else it }
        val image = if (type.startsWith("image/")) streamUri(intent)?.let { copyToCache(context, it) } else null
        if (text.isNullOrBlank() && image == null) return false
        _pending.value = SharedContent(text?.trim(), image)
        return true
    }

    fun consume(): SharedContent? = _pending.value.also { _pending.value = null }

    @Suppress("DEPRECATION")
    private fun streamUri(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }

    // El permiso para leer la foto que da la otra app es temporal: se copia
    // enseguida a la caché propia y se usa esa copia.
    private fun copyToCache(context: Context, source: Uri): Uri? {
        return try {
            val file = File(context.cacheDir, "compartida-${System.currentTimeMillis()}.img")
            val input = context.contentResolver.openInputStream(source) ?: return null
            input.use { stream -> file.outputStream().use { stream.copyTo(it) } }
            Uri.fromFile(file)
        } catch (e: Exception) {
            null
        }
    }
}
