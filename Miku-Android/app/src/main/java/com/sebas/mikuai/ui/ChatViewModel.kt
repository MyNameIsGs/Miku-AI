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
    val imageUri: String? = null, // Para renderizar la imagen localmente en la burbuja
    // Idea #10 + ronda 2 de diseño: lo que se habló por "Hey Miku" va en el
    // mismo chat, con un separador "POR VOZ · hora" y la burbuja punteada.
    val fromVoice: Boolean = false,
    val timestampMs: Long? = null,
)

// Una tool del ciclo actual, para el rastro de "pensando" (ronda 2).
data class UiTool(val id: Int, val name: String, val done: Boolean)

data class ChatUiState(
    val messages : List<UiMessage> = emptyList(),
    val isLoading: Boolean         = false,
    val statusText: String         = "Cargando memoria…",
    val isReady  : Boolean         = false,
    val error    : String?         = null,
    val selectedImageUri: Uri?     = null, // Estado de la foto adjunta actualmente
    val toolTrail: List<UiTool>    = emptyList(),
)

class ChatViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs      = SecurePrefs(app)
    private var repo       = buildRepo()
    private var memory: MikuMemory? = null
    private val history    = mutableListOf<ChatMessage>()  // historial de sesión
    private var voiceHistoryLoaded = false // ver comentario en loadMemory()

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState

    init {
        loadMemory()
    }

    private fun buildRepo(): MikuRepository? {
        val gh = prefs.getGitHubToken() ?: return null
        val or = prefs.getOpenRouterKey() ?: return null
        return MikuRepository(gh, or, getApplication(), prefs)
    }

    fun isSpotifyConnected(): Boolean = repo?.isSpotifyConnected() ?: false

    fun connectSpotify(onResult: (success: Boolean, error: String?) -> Unit) {
        viewModelScope.launch {
            try {
                val r = repo ?: throw IllegalStateException("Sin credenciales")
                r.connectSpotify()
                onResult(true, null)
            } catch (e: Exception) {
                onResult(false, e.message)
            }
        }
    }

    fun listConnectedGmailEmails(): List<String> = repo?.listConnectedGmailEmails() ?: emptyList()

    fun connectGmail(onResult: (email: String?, error: String?) -> Unit) {
        viewModelScope.launch {
            try {
                val r = repo ?: throw IllegalStateException("Sin credenciales")
                val email = r.connectGmail()
                onResult(email, null)
            } catch (e: Exception) {
                onResult(null, e.message)
            }
        }
    }

    fun disconnectGmailAccount(email: String) {
        repo?.disconnectGmailAccount(email)
    }

    fun listConnectedCalendarEmails(): List<String> = repo?.listConnectedCalendarEmails() ?: emptyList()

    fun connectCalendar(onResult: (email: String?, error: String?) -> Unit) {
        viewModelScope.launch {
            try {
                val r = repo ?: throw IllegalStateException("Sin credenciales")
                val email = r.connectCalendar()
                onResult(email, null)
            } catch (e: Exception) {
                onResult(null, e.message)
            }
        }
    }

    fun disconnectCalendarAccount(email: String) {
        repo?.disconnectCalendarAccount(email)
    }

    private fun loadMemory() {
        viewModelScope.launch {
            try {
                val r = repo ?: run {
                    _uiState.value = _uiState.value.copy(error = "Sin credenciales")
                    return@launch
                }
                memory = r.loadMemory()

                // Idea #10: mostrar las conversaciones por "Hey Miku" que
                // pasaron mientras la app estaba cerrada -- se agregan tanto
                // a la UI (con 🎙️ para distinguirlas) como al historial que
                // se manda al LLM, para que recuerde lo que se le pidió por
                // voz igual que si hubiera sido por texto. Un fallo acá no
                // debe bloquear el resto del chat.
                //
                // Se carga UNA SOLA VEZ por instancia de ChatViewModel --
                // "↺ Recargar memoria desde GitHub" llama a loadMemory() de
                // nuevo sin recrear el ViewModel, y sin este guard cada
                // recarga hubiera vuelto a agregar (duplicado) el mismo
                // historial de voz que ya estaba en pantalla.
                if (!voiceHistoryLoaded) {
                    voiceHistoryLoaded = true
                    try {
                        r.loadVoiceHistory().sortedBy { it.timestampMs }.forEach { entry ->
                            addMessage(UiMessage("user", entry.heard, fromVoice = true, timestampMs = entry.timestampMs))
                            history.add(ChatMessage("user", entry.heard))
                            addMessage(UiMessage("miku", entry.reply, fromVoice = true, timestampMs = entry.timestampMs))
                            history.add(ChatMessage("assistant", entry.reply))
                        }
                    } catch (e: Exception) {}
                }

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

        _uiState.value = _uiState.value.copy(isLoading = true, toolTrail = emptyList())

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

                val activePendientes = r.loadActivePendientes()
                val systemPrompt = Prompts.buildChatPrompt(mem, activePendientes, r.loadMoodWords())
                var toolCount = 0
                val raw          = r.chatWithTools(systemPrompt, history.dropLast(1), promptText, base64Payload) { name, done ->
                    val trail = _uiState.value.toolTrail
                    _uiState.value = _uiState.value.copy(
                        toolTrail = if (!done) {
                            trail + UiTool(toolCount++, name, false)
                        } else {
                            // Termina la última en curso con ese nombre.
                            val i = trail.indexOfLast { it.name == name && !it.done }
                            if (i < 0) trail else trail.toMutableList().also { it[i] = it[i].copy(done = true) }
                        }
                    )
                }
                val parsed       = MarkerParser.parse(raw)
                // Ánimo compartido: si cambió, se escribe sin frenar la respuesta.
                parsed.moodPush?.let { push -> viewModelScope.launch { r.pushMood(push) } }

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
                // Tarea 8.11: saber práctico, a conocimiento.md.
                parsed.saveKnowledge.forEach { t ->
                    launch {
                        try {
                            val updated = r.appendToFile(mem, "conocimiento", t)
                            memory = mem.copy(knowledge = updated)
                        } catch (_: Exception) {}
                    }
                }

            } catch (e: Exception) {
                if (history.isNotEmpty()) {
                    history.removeAt(history.lastIndex) // revertir user msg
                }
                addMessage(UiMessage("system", e.message ?: "No pude responder."))
            } finally {
                _uiState.value = _uiState.value.copy(isLoading = false, toolTrail = emptyList())
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