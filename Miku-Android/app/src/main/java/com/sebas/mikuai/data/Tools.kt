package com.sebas.mikuai.data

import org.json.JSONArray
import org.json.JSONObject

// Primer paso de tool calling en Android -- mismo protocolo nativo de
// OpenRouter que usa desktop (lib/tools/ allá), lista blanca de dos
// herramientas para arrancar. Sumar una tool nueva es agregarla acá, sin
// tocar OpenRouterApi ni el ciclo de tool calling en sí.
object Tools {

    fun schemas(): JSONArray = JSONArray().apply {
        put(
            buildTool(
                name = "anotar_pendiente",
                description = "Anota algo que Sebastián contó que va a pasar en el futuro (un pedido en camino, una cita, algo por hacer), con una fecha estimada, para poder recordárselo más adelante por tu cuenta.",
                properties = JSONObject().apply {
                    put("descripcion", JSONObject().apply {
                        put("type", "string")
                        put("description", "Descripción breve de lo que va a pasar.")
                    })
                    put("fecha_estimada", JSONObject().apply {
                        put("type", "string")
                        put("description", "Fecha estimada en formato YYYY-MM-DD, calculada a partir de la fecha de hoy y lo que dijo Sebastián.")
                    })
                },
                required = listOf("descripcion", "fecha_estimada"),
            )
        )
        put(
            buildTool(
                name = "cerrar_pendiente",
                description = "Marca como resuelto un pendiente activo, cuando Sebastián confirma que ya pasó o se solucionó. Busca por coincidencia parcial de la descripción, no hace falta el texto exacto.",
                properties = JSONObject().apply {
                    put("descripcion", JSONObject().apply {
                        put("type", "string")
                        put("description", "Texto que identifique el pendiente a cerrar.")
                    })
                },
                required = listOf("descripcion"),
            )
        )
    }

    suspend fun execute(name: String, argumentsJson: String, pendientes: PendientesRepository): String {
        val args = try {
            JSONObject(argumentsJson)
        } catch (e: Exception) {
            return "Error: los argumentos recibidos para \"$name\" no son JSON válido."
        }

        return try {
            when (name) {
                "anotar_pendiente" -> pendientes.anotarPendiente(
                    args.getString("descripcion"),
                    args.getString("fecha_estimada"),
                )
                "cerrar_pendiente" -> pendientes.cerrarPendiente(args.getString("descripcion"))
                else -> "Error: no existe una herramienta llamada \"$name\"."
            }
        } catch (e: Exception) {
            "Error ejecutando \"$name\": ${e.message}"
        }
    }

    private fun buildTool(
        name: String,
        description: String,
        properties: JSONObject,
        required: List<String>,
    ): JSONObject = JSONObject().apply {
        put("type", "function")
        put("function", JSONObject().apply {
            put("name", name)
            put("description", description)
            put("parameters", JSONObject().apply {
                put("type", "object")
                put("properties", properties)
                put("required", JSONArray(required))
            })
        })
    }
}
