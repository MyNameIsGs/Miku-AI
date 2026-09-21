package com.sebas.mikuai.voice

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Estado de la descarga de los 4 modelos de la voz real de Miku. */
sealed class ModelDownloadState {
    data object NotStarted : ModelDownloadState()
    data object Ready : ModelDownloadState()
    data class Downloading(val fileName: String, val downloadedBytes: Long, val totalBytes: Long) : ModelDownloadState()
    data class Failed(val message: String) : ModelDownloadState()
}

/**
 * Descarga los 4 modelos ONNX de la voz real de Miku (~518MB) desde un
 * GitHub Release -- puerto a Kotlin del mismo patrón que ya usa el desktop
 * para el `.exe` del servidor de voz (`voice_server_provision.rs`):
 * manifest.json con tamaño+sha256 de cada archivo, descarga a `.download`,
 * verificación de tamaño y hash, rename al nombre final. Se queda en
 * `filesDir` (privado de la app), no en `assets/` del APK -- demasiado
 * grande para eso, a diferencia de los modelos chicos del wake-word.
 */
class ModelDownloadManager(private val context: Context) {

    private val _state = MutableStateFlow<ModelDownloadState>(
        if (RvcModelPaths.allReady(context)) ModelDownloadState.Ready else ModelDownloadState.NotStarted
    )
    val state: StateFlow<ModelDownloadState> = _state.asStateFlow()

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    fun areModelsReady(): Boolean = RvcModelPaths.allReady(context)

    /** Descarga (o re-verifica) los 4 modelos. Seguro de reintentar: los archivos ya presentes+verificados se saltean. */
    suspend fun ensureModelsReady() = withContext(Dispatchers.IO) {
        try {
            val dir = RvcModelPaths.generator(context).parentFile!!
            dir.mkdirs()

            val manifestJson = fetchManifest()

            for ((key, target) in mapOf(
                "generator" to RvcModelPaths.generator(context),
                "hubert" to RvcModelPaths.hubert(context),
                "rmvpe" to RvcModelPaths.rmvpe(context),
                "melspectrogram" to RvcModelPaths.melspectrogram(context),
            )) {
                val entry = manifestJson.getJSONObject(key)
                val fileName = entry.getString("file")
                val expectedSize = entry.getLong("size")
                val expectedSha256 = entry.getString("sha256")

                if (target.exists() && target.length() == expectedSize && sha256Of(target) == expectedSha256) {
                    continue // ya está, no hace falta volver a bajarlo
                }

                downloadOne(fileName, target, expectedSize, expectedSha256)
            }

            _state.value = ModelDownloadState.Ready
        } catch (e: Exception) {
            _state.value = ModelDownloadState.Failed(e.message ?: "Error desconocido descargando la voz de Miku")
        }
    }

    private fun fetchManifest(): JSONObject {
        val request = Request.Builder()
            .url("https://github.com/$REPO/releases/download/$TAG/manifest.json")
            .build()
        val response = client.newCall(request).execute()
        response.use {
            if (!it.isSuccessful) throw IOException("manifest.json respondió ${it.code}")
            return JSONObject(it.body!!.string())
        }
    }

    private fun downloadOne(fileName: String, target: File, expectedSize: Long, expectedSha256: String) {
        val tmp = File(target.parentFile, "$fileName.download")
        val request = Request.Builder()
            .url("https://github.com/$REPO/releases/download/$TAG/$fileName")
            .build()

        val response = client.newCall(request).execute()
        response.use { resp ->
            if (!resp.isSuccessful) {
                tmp.delete()
                throw IOException("$fileName respondió ${resp.code}")
            }
            val body = resp.body ?: throw IOException("$fileName sin cuerpo de respuesta")

            var downloaded = 0L
            var lastEmitted = 0L
            tmp.outputStream().use { out ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        out.write(buffer, 0, read)
                        downloaded += read
                        if (downloaded - lastEmitted >= PROGRESS_STEP_BYTES) {
                            lastEmitted = downloaded
                            _state.value = ModelDownloadState.Downloading(fileName, downloaded, expectedSize)
                        }
                    }
                }
            }
            _state.value = ModelDownloadState.Downloading(fileName, downloaded, expectedSize)
        }

        if (tmp.length() != expectedSize) {
            tmp.delete()
            throw IOException("$fileName: tamaño incorrecto tras descargar (esperado $expectedSize, se obtuvieron ${tmp.length()})")
        }
        val actualSha = sha256Of(tmp)
        if (actualSha != expectedSha256) {
            tmp.delete()
            throw IOException("$fileName: no coincide el hash (descarga corrupta)")
        }
        if (target.exists()) target.delete()
        if (!tmp.renameTo(target)) {
            throw IOException("No se pudo mover $fileName a su ubicación final")
        }
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        val sb = StringBuilder(64)
        for (b in digest.digest()) sb.append(String.format("%02x", b))
        return sb.toString()
    }

    companion object {
        private const val REPO = "MyNameIsGs/Miku-AI"
        private const val TAG = "rvc-android-assets"
        private const val PROGRESS_STEP_BYTES = 2L * 1024 * 1024
    }
}
