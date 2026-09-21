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
    data object Listening : MikuOverlayPhase()
    data object Thinking : MikuOverlayPhase()

    /**
     * [reply] recién se completa cuando el audio de la voz de Miku ya está
     * listo para reproducirse (o, si la voz está silenciada, de inmediato)
     * -- a propósito, para que el texto de la respuesta "aparezca" junto
     * con el audio, no antes (ver pedido de Sebastián).
     */
    data class Responding(val heard: String, val reply: String) : MikuOverlayPhase()
}

object MikuOverlayState {
    private val _phase = MutableStateFlow<MikuOverlayPhase>(MikuOverlayPhase.Idle)
    val phase: StateFlow<MikuOverlayPhase> = _phase.asStateFlow()

    fun update(phase: MikuOverlayPhase) {
        _phase.value = phase
    }
}
