package com.sebas.mikuai.data

import java.time.Instant
import java.time.LocalDate

// Idea #21: engancha los pendientes vencidos al resumen agrupado del
// wake-word (ver WakeWordService.kt), mismo criterio que desktop
// (lib/pendientes.ts, getDuePendientes/markPendientesReminded): activos,
// vencidos o por vencer dentro de DUE_SOON_DAYS, que no se hayan
// mencionado en las últimas REMINDER_COOLDOWN_MS.
//
// A diferencia de desktop (donde el loop idle llama al LLM y es Miku quien
// decide el texto exacto), acá se arma un texto fijo sin LLM -- mismo
// criterio que GmailWatcher/CalendarWatcher, para no sumar una llamada al
// modelo a cada chequeo de fondo (cada BACKGROUND_CHECK_INTERVAL_MS).
private const val DUE_SOON_DAYS = 3L
private const val REMINDER_COOLDOWN_MS = 3 * 60 * 60 * 1000L // 3 horas

class PendientesWatcher(private val pendientesRepo: PendientesRepository) {

    suspend fun checkDuePendientes(): String? {
        val activos = pendientesRepo.loadActivePendientes()
        if (activos.isEmpty()) return null

        val now = System.currentTimeMillis()
        val threshold = LocalDate.now().plusDays(DUE_SOON_DAYS)

        val due = activos.filter { p ->
            val fecha = runCatching { LocalDate.parse(p.fechaEstimada) }.getOrNull()
                ?: return@filter false
            if (fecha.isAfter(threshold)) return@filter false
            val ultimoMs = p.ultimoRecordatorio?.let {
                runCatching { Instant.parse(it).toEpochMilli() }.getOrNull()
            }
            if (ultimoMs != null && now - ultimoMs < REMINDER_COOLDOWN_MS) return@filter false
            true
        }
        if (due.isEmpty()) return null

        val announcement = if (due.size == 1) {
            "Se me ocurrió: tenías pendiente \"${due[0].descripcion}\"."
        } else {
            "También tienes un par de pendientes que se acercan: " +
                due.joinToString(", ") { "\"${it.descripcion}\"" } + "."
        }

        pendientesRepo.marcarRecordados(due.map { it.id })
        return announcement
    }
}
