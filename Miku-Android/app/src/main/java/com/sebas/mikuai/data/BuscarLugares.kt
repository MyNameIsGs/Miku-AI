package com.sebas.mikuai.data

import android.content.Context
import com.sebas.mikuai.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * Google Maps, paso 3 (2026-09-28): la tool buscar_lugares, con Places API
 * (New) Text Search. Mismos campos y mismo texto de salida que
 * lib/places.ts + lib/tools/buscarLugares.ts de desktop. Pedir valoración
 * y horario hace que cada búsqueda se cobre como "Enterprise" (1.000
 * gratis por mes): de sobra para uso personal.
 */
object BuscarLugares {
    private const val URL = "https://places.googleapis.com/v1/places:searchText"
    private const val FIELD_MASK = "places.displayName,places.formattedAddress,places.rating,places.userRatingCount," +
        "places.currentOpeningHours.openNow,places.currentOpeningHours.weekdayDescriptions,places.nationalPhoneNumber"
    private const val MAX_RESULTS = 5
    private const val NEARBY_RADIUS_M = 5000.0

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun execute(context: Context, args: JSONObject): String {
        val query = args.optString("consulta", "").trim()
        if (query.isEmpty()) return "Error: no se especificó qué buscar."
        if (BuildConfig.MAPS_API_KEY.isBlank()) return "Error: falta la clave de Google Maps (maps.apiKey en local.properties)."

        val body = JSONObject().apply {
            put("textQuery", query)
            put("languageCode", "es")
            put("maxResultCount", MAX_RESULTS)
        }
        var nearbyNote = ""
        if (args.optBoolean("cerca_de_mi", false)) {
            val here = MiUbicacion.coordinates(context)
            if (here != null) {
                body.put("locationBias", JSONObject().put("circle", JSONObject().apply {
                    put("center", JSONObject().put("latitude", here.latitude).put("longitude", here.longitude))
                    put("radius", NEARBY_RADIUS_M)
                }))
            } else {
                nearbyNote = "\n(No pude saber dónde está Sebastián: sin permiso de ubicación o sin señal. Los resultados no están ordenados por cercanía.)"
            }
        }

        return try {
            val (code, raw) = withContext(Dispatchers.IO) {
                val request = Request.Builder()
                    .url(URL)
                    .addHeader("X-Goog-Api-Key", BuildConfig.MAPS_API_KEY)
                    .addHeader("X-Goog-FieldMask", FIELD_MASK)
                    .post(body.toString().toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(request).execute().use { it.code to it.body?.string().orEmpty() }
            }
            val json = try { JSONObject(raw) } catch (e: Exception) { JSONObject() }
            if (code !in 200..299) {
                val message = json.optJSONObject("error")?.optString("message").orEmpty().ifBlank { "sin detalle" }
                "Error al buscar lugares: Google respondió $code: $message"
            } else {
                format(json.optJSONArray("places"), query, LocalDate.now()) + nearbyNote
            }
        } catch (e: Exception) {
            "Error al buscar lugares: ${e.message}"
        }
    }

    // weekdayDescriptions viene de lunes a domingo; DayOfWeek.value es 1 (lunes) a 7.
    private fun format(places: JSONArray?, query: String, today: LocalDate): String {
        if (places == null || places.length() == 0) return "No encontré lugares para \"$query\"."
        val todayIndex = today.dayOfWeek.value - 1
        return (0 until places.length()).joinToString("\n") { i ->
            val p = places.getJSONObject(i)
            buildString {
                append("${i + 1}. ${p.optJSONObject("displayName")?.optString("text").orEmpty().ifBlank { "(sin nombre)" }}")
                p.optString("formattedAddress").takeIf { it.isNotBlank() }?.let { append("\n   Dirección: $it") }
                if (p.has("rating")) {
                    val count = p.optInt("userRatingCount", 0)
                    append("\n   Valoración: ${p.getDouble("rating")}${if (count > 0) " ($count opiniones)" else ""}")
                }
                p.optJSONObject("currentOpeningHours")?.let { hours ->
                    val now = if (!hours.has("openNow")) "" else if (hours.getBoolean("openNow")) "abierto ahora" else "cerrado ahora"
                    val todayLine = hours.optJSONArray("weekdayDescriptions")?.optString(todayIndex).orEmpty()
                    val parts = listOf(now, if (todayLine.isNotBlank()) "hoy $todayLine" else "").filter { it.isNotBlank() }
                    append("\n   Horario: ${parts.joinToString("; ")}")
                }
                p.optString("nationalPhoneNumber").takeIf { it.isNotBlank() }?.let { append("\n   Teléfono: $it") }
            }
        }
    }
}
