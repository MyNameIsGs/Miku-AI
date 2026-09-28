package com.sebas.mikuai.wakeword

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Estado compartido entre `WakeWordService` (que hace el trabajo real:
 * STT, chat, síntesis de voz) y `MikuOverlayActivity` (que solo dibuja según
 * este estado) -- viven en el mismo proceso, así que un `StateFlow` simple
 * alcanza, no hace falta IPC/binder.
 */
sealed class MikuOverlayPhase {
    data object Idle : MikuOverlayPhase()

    /** [partial]: lo que el reconocedor va entendiendo mientras hablas. */
    data class Listening(val partial: String = "") : MikuOverlayPhase()

    /**
     * [heard]: lo que dijiste (eco «TÚ · …»); [tools]: el rastro de tools
     * del ciclo actual, en orden (ronda 2 de diseño).
     */
    data class Thinking(val heard: String = "", val tools: List<OverlayTool> = emptyList()) : MikuOverlayPhase()

    /**
     * [reply] recién se completa cuando el audio de la voz de Miku ya está
     * listo para reproducirse (o, si la voz está silenciada, de inmediato)
     * -- a propósito, para que el texto de la respuesta "aparezca" junto
     * con el audio, no antes (ver pedido de Sebastián).
     */
    data class Responding(
        val heard: String,
        val reply: String,
        // Karaoke (ronda 2 de diseño): el texto se revela por palabras al
        // ritmo del audio. [durationMs] = 0 → se muestra completo de una
        // (voz silenciada).
        val startedAtMs: Long = 0L,
        val durationMs: Long = 0L,
        // Nivel de la voz cada [LEVEL_STEP_MS] ms (0-1), para la tira de
        // teclas; null si no hay audio que medir (voz del sistema).
        val levels: FloatArray? = null,
    ) : MikuOverlayPhase() {
        companion object {
            const val LEVEL_STEP_MS = 50L
        }
    }
}

data class OverlayTool(val name: String, val done: Boolean)

object MikuOverlayState {
    private val _phase = MutableStateFlow<MikuOverlayPhase>(MikuOverlayPhase.Idle)
    val phase: StateFlow<MikuOverlayPhase> = _phase.asStateFlow()

    fun update(phase: MikuOverlayPhase) {
        _phase.value = phase
    }

    /** Suma o termina una tool en el rastro, si sigue pensando. */
    fun toolEvent(name: String, done: Boolean) {
        val current = _phase.value as? MikuOverlayPhase.Thinking ?: return
        val tools = if (!done) {
            current.tools + OverlayTool(name, false)
        } else {
            val i = current.tools.indexOfLast { it.name == name && !it.done }
            if (i < 0) current.tools else current.tools.toMutableList().also { it[i] = it[i].copy(done = true) }
        }
        _phase.value = current.copy(tools = tools)
    }
}
