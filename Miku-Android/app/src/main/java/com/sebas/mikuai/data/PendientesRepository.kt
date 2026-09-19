package com.sebas.mikuai.data

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

private const val PENDIENTES_PATH = "Miku-AI/memory/pendientes.json"

// Primer paso de tool calling en Android (Nivel 3 de la Tarea 6.7 del lado
// desktop, primer paso del lado Android): lee/escribe pendientes.json
// directo contra la API de contenidos de GitHub -- mismo archivo que ya
// sincroniza el desktop, ningún almacén nuevo. Se eligió como primera tool
// de Android justamente porque no necesita credenciales nuevas (el GitHub
// token ya existe) ni ningún flujo de OAuth propio, a diferencia de
// Spotify/Gmail.
class PendientesRepository(private val ghApi: GitHubApi) {

    suspend fun loadActivePendientes(): List<Pendiente> {
        return try {
            parsePendientesJson(ghApi.getFile(PENDIENTES_PATH).content).filter { it.estado == "activo" }
        } catch (e: Exception) {
            emptyList()
        }
    }

    suspend fun anotarPendiente(descripcion: String, fechaEstimada: String): String {
        val nuevo = Pendiente(
            id = UUID.randomUUID().toString(),
            descripcion = descripcion,
            fechaEstimada = fechaEstimada,
            creadoEn = Instant.now().toString(),
            estado = "activo",
            ultimoRecordatorio = null
        )
        writeWithRetry { current -> current + nuevo }
        return "Anotado: \"$descripcion\" (estimado: $fechaEstimada)."
    }

    // Mismo criterio que cerrar_pendiente en desktop: coincidencia parcial
    // de descripción, no id -- el id nunca se le expone al modelo.
    suspend fun cerrarPendiente(query: String): String {
        var found: Pendiente? = null
        writeWithRetry { current ->
            val normalized = query.trim().lowercase()
            current.map { p ->
                if (found == null && p.estado == "activo" && p.descripcion.lowercase().contains(normalized)) {
                    found = p
                    p.copy(estado = "cerrado")
                } else {
                    p
                }
            }
        }
        val closed = found
        return if (closed != null) {
            "Cerrado: \"${closed.descripcion}\"."
        } else {
            "No encontré ningún pendiente activo que coincida con \"$query\"."
        }
    }

    // Mismo patrón de reintento ante SHA obsoleto que appendToFile en
    // MikuRepository -- si otro proceso (desktop, u otra sesión) escribió
    // el archivo entre el GET y el PUT, se vuelve a leer y reintentar una
    // vez con el SHA fresco.
    //
    // También contempla que el archivo todavía no exista en el repo -- a
    // diferencia de world.md/personality.md/memories.md (que siempre
    // existieron desde el principio del proyecto), pendientes.json puede
    // no haberse creado nunca todavía en ningún lado. Un 404 acá significa
    // eso, no un error real: se arranca de una lista vacía y se crea sin
    // "sha" (así le indica a la API de GitHub que es un archivo nuevo).
    private suspend fun writeWithRetry(transform: (List<Pendiente>) -> List<Pendiente>) {
        val ts = LocalDate.now().toString()
        val (currentContent, currentSha) = try {
            val file = ghApi.getFile(PENDIENTES_PATH)
            file.content to file.sha
        } catch (e: Exception) {
            if (e.message?.contains("404") == true) "[]" to null else throw e
        }

        try {
            ghApi.putFile(
                PENDIENTES_PATH,
                serializePendientes(transform(parsePendientesJson(currentContent))),
                currentSha,
                "memory: pendientes.json [$ts] (android)"
            )
        } catch (e: Exception) {
            if (e.message?.contains("409") == true || e.message?.contains("422") == true) {
                val fresh = ghApi.getFile(PENDIENTES_PATH)
                ghApi.putFile(
                    PENDIENTES_PATH,
                    serializePendientes(transform(parsePendientesJson(fresh.content))),
                    fresh.sha,
                    "memory: pendientes.json [$ts] (android, retry)"
                )
            } else {
                throw e
            }
        }
    }
}
