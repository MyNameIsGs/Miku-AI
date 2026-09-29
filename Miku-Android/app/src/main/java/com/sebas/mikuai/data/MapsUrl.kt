package com.sebas.mikuai.data

import android.net.Uri

/**
 * Google Maps URLs (developers.google.com/maps/documentation/urls): no
 * necesitan clave. En el celular abren la app de Maps (o el navegador si
 * no está). Misma construcción que lib/mapsUrl.ts de desktop.
 */
object MapsUrl {
    val ACTIONS = listOf("buscar", "ruta", "navegar")
    private val MODE_PARAM = mapOf(
        "auto" to "driving",
        "caminando" to "walking",
        "bicicleta" to "bicycling",
        "transporte_publico" to "transit",
        "moto" to "two-wheeler",
    )
    val MODES = MODE_PARAM.keys.toList()

    /** Sin origen, Maps usa la ubicación actual del celular. */
    fun build(action: String, destination: String, origin: String?, mode: String?): String {
        if (action == "buscar") {
            return Uri.parse("https://www.google.com/maps/search/").buildUpon()
                .appendQueryParameter("api", "1")
                .appendQueryParameter("query", destination)
                .build().toString()
        }
        val builder = Uri.parse("https://www.google.com/maps/dir/").buildUpon()
            .appendQueryParameter("api", "1")
        if (!origin.isNullOrBlank()) builder.appendQueryParameter("origin", origin)
        builder.appendQueryParameter("destination", destination)
        MODE_PARAM[mode]?.let { builder.appendQueryParameter("travelmode", it) }
        if (action == "navegar") builder.appendQueryParameter("dir_action", "navigate")
        return builder.build().toString()
    }
}
