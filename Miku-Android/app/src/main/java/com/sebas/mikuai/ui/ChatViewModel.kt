package com.sebas.mikuai.ui

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sebas.mikuai.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.InputStream

data class UiMessage(
    val role: String, 
    val text: String,
    val imageUri: String? = null // NUEVA: Para renderizar la imagen localmente en la burbuja
)

data class ChatUiState(
    val messages : List<UiMessage> = emptyList(),
    val isLoading: Boolean         = false,
    val statusText: String         = "Cargando memoria…",
    val isReady  : Boolean         = false,
    val error    : String?         = null,
    val selectedImageUri: Uri?     = null // NUEVA: Estado de la foto adjunta actualmente
)

class ChatViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs      = SecurePrefs(app)
    private var repo       = buildRepo()
    private var memory: MikuMemory? = null
    private val history    = mutableListOf<ChatMessage>()  // historial de sesión

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState

    init {
        loadMemory()
    }

    private fun buildRepo(): MikuRepository? {
        val gh = prefs.getGitHubToken() ?: return null
        val or = prefs.getOpenRouterKey() ?: return null
        return MikuRepository(gh, or)
    }

    private fun loadMemory() {
        viewModelScope.launch {
            try {
                val r = repo ?: run {
                    _uiState.value = _uiState.value.copy(error = "Sin credenciales")
                    return@launch
                }
                memory = r.loadMemory()

                // Mostrar mensaje de notificación pendiente si existe
                val pending = prefs.getPendingNotificationMessage()
                if (!pending.isNullOrBlank()) {
                    prefs.clearPendingNotificationMessage()
                    addMessage(UiMessage("miku", pending))
                    history.add(ChatMessage("assistant", pending))
                }

                _uiState.value = _uiState.value.copy(statusText = "Lista ✓", isReady = true)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    statusText = "Error cargando memoria",
                    error = e.message
                )
            }
        }
    }

    fun selectImage(uri: Uri?) {
        _uiState.value = _uiState.value.copy(selectedImageUri = uri)
    }

    fun sendMessage(text: String) {
        val imageUri = _uiState.value.selectedImageUri
        if (text.isBlank() && imageUri == null) return
        if (_uiState.value.isLoading) return
        
        val r = repo ?: return
        val mem = memory ?: return

        // Limpiamos la imagen seleccionada de inmediato en el estado de la UI
        _uiState.value = _uiState.value.copy(selectedImageUri = null)

        _uiState.value = _uiState.value.copy(isLoading = true)

        viewModelScope.launch {
            try {
                var base64Payload: String? = null
                val promptText = text.ifBlank { "Mira esta imagen" }

                // Convertir la imagen a Base64 optimizado si existe
                if (imageUri != null) {
                    base64Payload = convertUriToBase64(imageUri)
                }

                // Añadir a la UI local
                addMessage(UiMessage("user", promptText, imageUri?.toString()))
                history.add(ChatMessage("user", promptText, base64Payload))

                // Recortar historial a 20 turnos (40 mensajes)
                while (history.size > 40) { history.removeAt(0); history.removeAt(0) }

                val systemPrompt = Prompts.buildChatPrompt(mem)
                val raw          = r.chat(systemPrompt, history.dropLast(1), promptText, base64Payload)
                val parsed       = MarkerParser.parse(raw)

                addMessage(UiMessage("miku", parsed.cleanText))
                history.add(ChatMessage("assistant", parsed.cleanText))

                // Guardar en GitHub (fire-and-forget)
                parsed.savePersonality.forEach { t ->
                    launch {
                        try {
                            val updated = r.appendToFile(mem, "personality", t)
                            memory = mem.copy(personality = updated)
                        } catch (_: Exception) {}
                    }
                }
                parsed.saveMemories.forEach { t ->
                    launch {
                        try {
                            val updated = r.appendToFile(mem, "memories", t)
                            memory = mem.copy(memories = updated)
                        } catch (_: Exception) {}
                    }
                }

            } catch (e: Exception) {
                if (history.isNotEmpty()) {
                    history.removeAt(history.lastIndex) // revertir user msg
                }
                addMessage(UiMessage("system", "⚠ ${e.message}"))
            } finally {
                _uiState.value = _uiState.value.copy(isLoading = false)
            }
        }
    }

    private suspend fun convertUriToBase64(uri: Uri): String? = withContext(Dispatchers.IO) {
        try {
            val context = getApplication<Application>().applicationContext
            val inputStream: InputStream? = context.contentResolver.openInputStream(uri)
            val originalBitmap = BitmapFactory.decodeStream(inputStream) ?: return@withContext null
            
            // Redimensionar para evitar que la petición sea masiva (max 800px)
            val maxDimension = 800
            val width = originalBitmap.width
            val height = originalBitmap.height
            val scaledBitmap = if (width > maxDimension || height > maxDimension) {
                val ratio = width.toFloat() / height.toFloat()
                val newWidth = if (ratio > 1) maxDimension else (maxDimension * ratio).toInt()
                val newHeight = if (ratio > 1) (maxDimension / ratio).toInt() else maxDimension
                Bitmap.createScaledBitmap(originalBitmap, newWidth, newHeight, true)
            } else {
                originalBitmap
            }

            val outputStream = ByteArrayOutputStream()
            scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 80, outputStream)
            val bytes = outputStream.toByteArray()
            Base64.encodeToString(bytes, Base64.NO_WRAP)
        } catch (e: Exception) {
            null
        }
    }

    fun reloadMemory() {
        memory = null
        _uiState.value = _uiState.value.copy(isReady = false, statusText = "Recargando…")
        loadMemory()
    }

    fun logout() {
        prefs.clearAll()
    }

    private fun addMessage(msg: UiMessage) {
        _uiState.value = _uiState.value.copy(
            messages = _uiState.value.messages + msg
        )
    }
}