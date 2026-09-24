package com.sebas.mikuai.data

// Tarea 6.3 en Android: mismo comportamiento que lib/tools/buscarEnWeb.ts
// del lado desktop -- misma instrucción de sistema, mismo MAX_RESULTS y
// mismos textos de vuelta, para que Miku reciba lo mismo desde los dos
// lados. La llamada HTTP en sí vive en OpenRouterApi.webSearch (la key es
// privada de esa clase); acá queda lo que ve el modelo.
//
// Lo usan tanto la tool buscar_en_web (Tools.kt) como el chequeo de
// tareas de seguimiento (TareasSeguimientoWatcher.kt), igual que desktop
// reusa buscarEnWeb.execute desde useTaskWatcher.ts.
object BuscarEnWeb {

    const val MAX_RESULTS = 3

    private const val SYSTEM_PROMPT =
        "Eres una herramienta de búsqueda web. Responde la consulta de forma breve y factual, citando las fuentes con enlaces markdown. Si la búsqueda no trae nada útil, dilo en vez de inventar una respuesta. No des precios en vivo ni asumas que se puede reservar nada con esta información -- son datos de referencia, no en tiempo real."

    suspend fun execute(orApi: OpenRouterApi, consultaRaw: String): String {
        val consulta = consultaRaw.trim()
        if (consulta.isEmpty()) {
            return "Error: no se especificó qué buscar."
        }

        return try {
            val content = orApi.webSearch(SYSTEM_PROMPT, consulta, MAX_RESULTS)
            if (content.isBlank()) {
                "No encontré nada útil buscando \"$consulta\"."
            } else {
                content
            }
        } catch (e: Exception) {
            "Error al buscar en la web: ${e.message}"
        }
    }
}
