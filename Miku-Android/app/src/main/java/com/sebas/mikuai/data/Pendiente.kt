package com.sebas.mikuai.data

import org.json.JSONArray
import org.json.JSONObject

// Mismo esquema que pendientes.json del lado desktop (lib/pendientes.ts) --
// es el MISMO archivo, sincronizado por GitHub, así que hay que preservar
// todos los campos al escribir aunque Android no use ultimoRecordatorio
// para nada todavía (eso es lógica del loop idle de desktop).
//
// Idea #9: condicion/ultimaRevisionCondicion son de las tareas de
// seguimiento (desktop, lib/pendientes.ts). Android también las revisa
// sola (TareasSeguimientoWatcher.kt, con buscar_en_web) -- como es el
// mismo archivo, ultimaRevisionCondicion lo comparten los dos lados: si
// desktop ya revisó una tarea hace poco, Android no la vuelve a buscar
// (y al revés), así no se paga dos veces la misma búsqueda.
data class Pendiente(
    val id: String,
    val descripcion: String,
    val fechaEstimada: String,
    val creadoEn: String,
    val estado: String, // "activo" | "cerrado"
    val ultimoRecordatorio: String?,
    val condicion: String? = null,
    val ultimaRevisionCondicion: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("descripcion", descripcion)
        put("fechaEstimada", fechaEstimada)
        put("creadoEn", creadoEn)
        put("estado", estado)
        put("ultimoRecordatorio", ultimoRecordatorio ?: JSONObject.NULL)
        put("condicion", condicion ?: JSONObject.NULL)
        put("ultimaRevisionCondicion", ultimaRevisionCondicion ?: JSONObject.NULL)
    }

    companion object {
        fun fromJson(obj: JSONObject): Pendiente = Pendiente(
            id = obj.getString("id"),
            descripcion = obj.getString("descripcion"),
            fechaEstimada = obj.getString("fechaEstimada"),
            creadoEn = obj.getString("creadoEn"),
            estado = obj.getString("estado"),
            ultimoRecordatorio = if (obj.isNull("ultimoRecordatorio")) null
            else obj.getString("ultimoRecordatorio"),
            condicion = if (!obj.has("condicion") || obj.isNull("condicion")) null
            else obj.getString("condicion"),
            ultimaRevisionCondicion = if (!obj.has("ultimaRevisionCondicion") || obj.isNull("ultimaRevisionCondicion")) null
            else obj.getString("ultimaRevisionCondicion")
        )
    }
}

fun parsePendientesJson(raw: String): List<Pendiente> {
    if (raw.isBlank()) return emptyList()
    val array = JSONArray(raw)
    return (0 until array.length()).map { Pendiente.fromJson(array.getJSONObject(it)) }
}

fun serializePendientes(pendientes: List<Pendiente>): String {
    val array = JSONArray()
    pendientes.forEach { array.put(it.toJson()) }
    return array.toString(2)
}
