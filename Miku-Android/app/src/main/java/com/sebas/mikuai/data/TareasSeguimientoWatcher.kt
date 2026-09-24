package com.sebas.mikuai.data

// Idea #9 en Android: mismo criterio que hooks/useTaskWatcher.ts del lado
// desktop -- pendientes con "condición" son tareas de seguimiento que Miku
// revisa sola cada tanto con una búsqueda real (BuscarEnWeb.kt), en vez de
// que buscar_en_web responda una vez y se olvide. Cada revisión cuesta
// dinero de verdad (una búsqueda + una llamada chica al LLM), por eso el
// intervalo es de horas y se revisa UNA tarea por ciclo nada más.
//
// Lo engancha el chequeo de fondo del wake-word (WakeWordService.kt), que
// corre cada pocos minutos -- el filtro de TASK_WATCH_INTERVAL_MS de acá
// es el que lo frena a una búsqueda cada varias horas.
//
// Mismo valor que TASK_WATCH_INTERVAL_MS en config/constants.ts.
private const val TASK_WATCH_INTERVAL_MS = 6 * 60 * 60 * 1000L // 6 horas

class TareasSeguimientoWatcher(
    private val pendientesRepo: PendientesRepository,
    private val orApi: OpenRouterApi,
) {

    // A diferencia de desktop (que arranca a contar desde que abre la app),
    // acá arranca en 0: Android puede matar y recrear el servicio seguido,
    // y si cada reinicio volviera a esperar 6 horas la revisión nunca
    // llegaría a correr. No hay riesgo de buscar de más -- el cooldown por
    // tarea (ultimaRevisionCondicion, en el archivo compartido) ya evita
    // repetir una tarea revisada hace poco, por desktop o por acá.
    private var lastCheckAt = 0L
    @Volatile private var isChecking = false

    // Devuelve el aviso para el resumen agrupado si una condición se
    // cumplió (no urgente -- mismo destino que queueAnnouncement en
    // desktop), o null si no toca revisar o sigue esperando.
    suspend fun checkTareas(): String? {
        val now = System.currentTimeMillis()
        if (isChecking || now - lastCheckAt < TASK_WATCH_INTERVAL_MS) return null
        lastCheckAt = now
        isChecking = true
        try {
            val tarea = pendientesRepo.loadTareasSeguimiento().firstOrNull() ?: return null
            val condicion = tarea.condicion ?: return null

            val consulta = "${tarea.descripcion}. $condicion"
            val searchResult = BuscarEnWeb.execute(orApi, consulta)

            val prompt = Prompts.buildTaskEvalPrompt(tarea.descripcion, condicion, searchResult)
            // Desktop manda solo el mensaje de sistema; chat() de acá
            // siempre agrega uno de usuario, así que va uno corto y neutro.
            val reply = orApi.chat(prompt, emptyList(), "Revisa la tarea y decide.").trim()

            pendientesRepo.marcarCondicionRevisada(listOf(tarea.id))

            if (!reply.uppercase().startsWith("CUMPLIDA")) return null

            val message = reply.lines().drop(1).joinToString(" ").trim()
            pendientesRepo.cerrarPendientePorId(tarea.id)
            return message.ifEmpty { "Se cumplió lo que estabas esperando: \"${tarea.descripcion}\"." }
        } finally {
            isChecking = false
        }
    }
}
