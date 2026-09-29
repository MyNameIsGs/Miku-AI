package com.sebas.mikuai.data

import android.content.Context
import com.sebas.mikuai.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Google Maps, paso 4 (2026-09-28): la tool tiempo_de_viaje, con Routes API
 * (computeRoutes). Mismo pedido y mismo texto que lib/routes.ts de desktop.
 * Con tráfico (TRAFFIC_AWARE) solo en auto y moto: los demás modos no lo
 * aceptan. En Caracas, transporte público devuelve {} (Google no tiene esos
 * datos ahí): se dice claro en vez de fallar.
 */
object TiempoDeViaje {
    private const val URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
    private const val FIELD_MASK = "routes.duration,routes.staticDuration,routes.distanceMeters,routes.localizedValues"

    private val ROUTES_MODE = mapOf(
        "auto" to "DRIVE",
        "caminando" to "WALK",
        "bicicleta" to "BICYCLE",
        "transporte_publico" to "TRANSIT",
        "moto" to "TWO_WHEELER",
    )
    private val MODE_WORDS = mapOf(
        "auto" to "En auto",
        "caminando" to "Caminando",
        "bicicleta" to "En bicicleta",
        "transporte_publico" to "En transporte público",
        "moto" to "En moto",
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun execute(context: Context, args: JSONObject): String {
        val destination = args.optString("destino", "").trim()
        if (destination.isEmpty()) return "Error: no se especificó el destino."
        if (BuildConfig.MAPS_API_KEY.isBlank()) return "Error: falta la clave de Google Maps (maps.apiKey en local.properties)."
        val mode = args.optString("modo", "auto").takeIf { it in ROUTES_MODE } ?: "auto"
        val withTraffic = mode == "auto" || mode == "moto"

        val originText = args.optString("origen", "").trim()
        val origin = if (originText.isNotEmpty()) {
            JSONObject().put("address", originText)
        } else {
            val here = MiUbicacion.coordinates(context)
                ?: return "Error: no sé desde dónde sale Sebastián (sin permiso de ubicación o sin señal). Pregúntale el origen."
            JSONObject().put("location", JSONObject().put("latLng", JSONObject().put("latitude", here.latitude).put("longitude", here.longitude)))
        }

        val body = JSONObject().apply {
            put("origin", origin)
            put("destination", JSONObject().put("address", destination))
            put("travelMode", ROUTES_MODE[mode])
            if (withTraffic) put("routingPreference", "TRAFFIC_AWARE")
            put("languageCode", "es")
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
                return "Error al calcular el viaje: Google respondió $code: $message"
            }
            val route = json.optJSONArray("routes")?.optJSONObject(0)
                ?: return if (mode == "transporte_publico") {
                    "Google no tiene rutas en transporte público para ir a \"$destination\" (en muchas ciudades no tiene datos de metro ni autobuses)."
                } else {
                    "Google no encontró una ruta ${MODE_WORDS[mode]!!.lowercase()} hasta \"$destination\"."
                }
            val loc = route.optJSONObject("localizedValues")
            val durationText = loc?.optJSONObject("duration")?.optString("text").orEmpty().ifBlank { "?" }
            val distanceText = loc?.optJSONObject("distance")?.optString("text").orEmpty().ifBlank { "?" }
            val staticText = loc?.optJSONObject("staticDuration")?.optString("text").orEmpty().ifBlank { "menos" }
            buildString {
                append("${MODE_WORDS[mode]}: $durationText hasta \"$destination\" ($distanceText)")
                if (withTraffic) {
                    val delay = seconds(route.optString("duration")) - seconds(route.optString("staticDuration"))
                    append(if (delay >= 180) ", con el tráfico de ahora; sin tráfico serían $staticText" else ", con el tráfico de ahora")
                }
                append(".")
            }
        } catch (e: Exception) {
            "Error al calcular el viaje: ${e.message}"
        }
    }

    // "2097s" -> 2097
    private fun seconds(duration: String): Int = duration.removeSuffix("s").toIntOrNull() ?: 0
}
