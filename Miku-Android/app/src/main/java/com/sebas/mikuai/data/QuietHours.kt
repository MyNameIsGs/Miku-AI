package com.sebas.mikuai.data

import java.util.Calendar

// Idea #20: franja horaria en la que ningún aviso automático (correo,
// Calendar, pendientes) habla solo -- se acumulan y se leen cuando termina.
// Mismo criterio que el lado desktop (lib/quietHours.ts): soporta que la
// franja cruce la medianoche además del caso simple (0 a 7) que se usa por
// defecto.
private const val QUIET_HOURS_START_HOUR = 0 // 00:00
private const val QUIET_HOURS_END_HOUR = 7 // 07:00

fun isQuietHours(): Boolean {
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    if (QUIET_HOURS_START_HOUR == QUIET_HOURS_END_HOUR) return false
    return if (QUIET_HOURS_START_HOUR < QUIET_HOURS_END_HOUR) {
        hour >= QUIET_HOURS_START_HOUR && hour < QUIET_HOURS_END_HOUR
    } else {
        hour >= QUIET_HOURS_START_HOUR || hour < QUIET_HOURS_END_HOUR
    }
}
