package com.sebas.mikuai.data

import org.json.JSONArray
import org.json.JSONObject

// Mismo esquema que pendientes.json del lado desktop (lib/pendientes.ts) --
// es el MISMO archivo, sincronizado por GitHub, así que hay que preservar
// todos los campos al escribir aunque Android no use ultimoRecordatorio
// para nada todavía (eso es lógica del loop idle de desktop).
data class Pendiente(
    val id: String,
    val descripcion: String,
    val fechaEstimada: String,
    val creadoEn: String,
    val estado: String, // "activo" | "cerrado"
    val ultimoRecordatorio: String?
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("descripcion", descripcion)
        put("fechaEstimada", fechaEstimada)
        put("creadoEn", creadoEn)
        put("estado", estado)
        put("ultimoRecordatorio", ultimoRecordatorio ?: JSONObject.NULL)
    }

    companion object {
        fun fromJson(obj: JSONObject): Pendiente = Pendiente(
            id = obj.getString("id"),
            descripcion = obj.getString("descripcion"),
            fechaEstimada = obj.getString("fechaEstimada"),
            creadoEn = obj.getString("creadoEn"),
            estado = obj.getString("estado"),
            ultimoRecordatorio = if (obj.isNull("ultimoRecordatorio")) null
            else obj.getString("ultimoRecordatorio")
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
