package com.sebas.mikuai.data

// Avisos de Calendar (idea #7), mismo diseño que la versión desktop
// (lib/calendar/watcher.ts): dos mecanismos independientes.
// 1. checkImminentEvent(): un evento está por EMPEZAR (ventana de
//    minutos) -- registro por id de evento -> cuándo se anunció, podado
//    después de una hora.
// 2. checkMilestoneEvent(): un evento CRUZÓ un umbral de anticipación
//    (1 semana / 3 días / el día anterior) -- registro por id de evento
//    -> qué umbrales ya se anunciaron para ESE evento puntual.
private const val IMMINENT_LEAD_MINUTES = 20
private const val FORGET_AFTER_MS = 60 * 60 * 1000L // 1 hora
private val MILESTONE_DAYS = listOf(7, 3, 1) // descendente a propósito

class CalendarWatcher(private val calendarApi: CalendarApi, private val prefs: SecurePrefs) {

    suspend fun checkImminentEvent(): String? {
        val events = calendarApi.listEventsStartingWithin(IMMINENT_LEAD_MINUTES)
        if (events.isEmpty()) return null

        val announced = prefs.getCalendarAnnouncedEvents().toMutableMap()
        val now = System.currentTimeMillis()
        announced.entries.removeAll { now - it.value > FORGET_AFTER_MS }

        var announcement: String? = null
        for (event in events) {
            if (announced.containsKey(event.id)) continue
            announced[event.id] = now
            if (announcement == null) {
                announcement = "Tienes \"${event.summary}\" ${formatEventTime(event)}" +
                    if (event.location.isNotBlank()) " en ${event.location}." else "."
            }
        }
        prefs.setCalendarAnnouncedEvents(announced)
        return announcement
    }

    suspend fun checkMilestoneEvent(): String? {
        val maxDays = MILESTONE_DAYS.max()
        val events = calendarApi.listUpcomingEventsAllAccounts(maxDays, 20)
        val announced = prefs.getCalendarMilestonesAnnounced().toMutableMap()

        val seenIds = events.map { it.id }.toSet()
        announced.keys.retainAll(seenIds)

        val now = System.currentTimeMillis()
        var announcement: String? = null

        for (event in events) {
            if (event.start.isBlank()) continue
            val startMs = parseEventStart(event.start) ?: continue
            val daysUntil = (startMs - now) / (24.0 * 60 * 60 * 1000)
            val alreadyAnnounced = announced[event.id]?.toMutableList() ?: mutableListOf()

            for (milestone in MILESTONE_DAYS) {
                if (daysUntil > milestone) continue
                if (alreadyAnnounced.contains(milestone)) continue
                alreadyAnnounced.add(milestone)
                if (announcement == null) {
                    announcement = "Tienes \"${event.summary}\" ${describeMilestone(milestone)}" +
                        if (event.location.isNotBlank()) " en ${event.location}." else "."
                }
                break
            }
            announced[event.id] = alreadyAnnounced
        }

        prefs.setCalendarMilestonesAnnounced(announced)
        return announcement
    }

    private fun describeMilestone(days: Int): String = when (days) {
        1 -> "mañana"
        7 -> "en una semana"
        else -> "en $days días"
    }

    private fun formatEventTime(event: CalendarEventSummary): String {
        if (!event.start.contains("T")) return "hoy"
        val startMs = parseEventStart(event.start) ?: return "pronto"
        val minutesUntil = ((startMs - System.currentTimeMillis()) / 60000).toInt()
        return if (minutesUntil <= 1) "ahora mismo" else "en $minutesUntil minutos"
    }

    private fun parseEventStart(start: String): Long? = try {
        if (start.contains("T")) {
            // OffsetDateTime, no Instant -- la API de Calendar devuelve
            // dateTime con el offset local del evento (ej. "-03:00"), no
            // necesariamente "Z", e Instant.parse() solo acepta "Z".
            java.time.OffsetDateTime.parse(start).toInstant().toEpochMilli()
        } else {
            java.time.LocalDate.parse(start)
                .atStartOfDay(java.time.ZoneId.systemDefault())
                .toInstant()
                .toEpochMilli()
        }
    } catch (e: Exception) {
        null
    }
}
