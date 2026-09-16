package com.sebas.mikuai.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sebas.mikuai.data.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class UiMessage(val role: String, val text: String)  // "miku" | "user" | "system"

data class ChatUiState(
    val messages : List<UiMessage> = emptyList(),
    val isLoading: Boolean         = false,
    val statusText: String         = "Cargando memoria…",
    val isReady  : Boolean         = false,
    val error    : String?         = null
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

    fun sendMessage(text: String) {
        if (text.isBlank() || _uiState.value.isLoading) return
        val r = repo ?: return
        val mem = memory ?: return

        addMessage(UiMessage("user", text))
        history.add(ChatMessage("user", text))

        // Recortar historial a 20 turnos (40 mensajes)
        while (history.size > 40) { history.removeAt(0); history.removeAt(0) }

        _uiState.value = _uiState.value.copy(isLoading = true)

        viewModelScope.launch {
            try {
                val systemPrompt = Prompts.buildChatPrompt(mem)
                val raw          = r.chat(systemPrompt, history.dropLast(1), text)
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
                history.removeLast() // revertir user msg
                addMessage(UiMessage("system", "⚠ ${e.message}"))
            } finally {
                _uiState.value = _uiState.value.copy(isLoading = false)
            }
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