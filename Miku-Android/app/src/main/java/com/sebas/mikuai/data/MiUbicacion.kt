package com.sebas.mikuai.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Google Maps, paso 2 (2026-09-28): la tool mi_ubicacion en el celular.
 * Con el LocationManager del sistema (sin librerías nuevas) y el Geocoder
 * de Android para pasarla a una dirección (gratis, en el propio celular).
 * Misma tool que lib/tools/miUbicacion.ts de desktop.
 */
object MiUbicacion {

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    suspend fun execute(context: Context): String {
        if (!hasPermission(context)) {
            return "Error: no tengo permiso de ubicación. Sebastián lo puede dar en Configuración → Conexiones → Ubicación."
        }
        val location = currentLocation(context)
            ?: return "Error: no pude obtener la ubicación ahora (¿está apagada la ubicación del celular?)."

        val ageSeconds = (System.currentTimeMillis() - location.time) / 1000
        val address = describe(context, location)
        val coords = "%.5f, %.5f".format(Locale.US, location.latitude, location.longitude)
        return buildString {
            append(if (address != null) "Sebastián está en: $address. " else "No pude pasarla a una dirección. ")
            append("Coordenadas: $coords (precisión ~${location.accuracy.toInt()} m")
            append(if (ageSeconds > 120) ", medida hace ${ageSeconds / 60} min)." else ").")
            append(" Para abrir_mapa puedes usar las coordenadas como origen.")
        }
    }

    /** Coordenadas para otras tools (buscar_lugares cerca, tiempo_de_viaje): null sin permiso o sin ubicación. */
    suspend fun coordinates(context: Context): Location? =
        if (hasPermission(context)) currentLocation(context) else null

    // Una lectura fresca (hasta 10 s); si no llega, la última conocida más reciente.
    @SuppressLint("MissingPermission") // se revisa antes de llamarla
    private suspend fun currentLocation(context: Context): Location? {
        val manager = context.getSystemService(LocationManager::class.java) ?: return null
        val providers = manager.getProviders(true)
        val provider = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && LocationManager.FUSED_PROVIDER in providers -> LocationManager.FUSED_PROVIDER
            LocationManager.GPS_PROVIDER in providers -> LocationManager.GPS_PROVIDER
            LocationManager.NETWORK_PROVIDER in providers -> LocationManager.NETWORK_PROVIDER
            else -> null
        }
        if (provider != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val fresh = withTimeoutOrNull(10_000) {
                suspendCancellableCoroutine<Location?> { cont ->
                    val signal = CancellationSignal()
                    cont.invokeOnCancellation { signal.cancel() }
                    manager.getCurrentLocation(provider, signal, context.mainExecutor) { cont.resume(it) }
                }
            }
            if (fresh != null) return fresh
        }
        return providers.mapNotNull { manager.getLastKnownLocation(it) }.maxByOrNull { it.time }
    }

    @Suppress("DEPRECATION") // la versión con listener es de API 33; esta corre en IO
    private suspend fun describe(context: Context, location: Location): String? = withContext(Dispatchers.IO) {
        if (!Geocoder.isPresent()) return@withContext null
        try {
            val address = Geocoder(context, Locale("es")).getFromLocation(location.latitude, location.longitude, 1)?.firstOrNull()
                ?: return@withContext null
            address.getAddressLine(0)
        } catch (e: Exception) {
            null
        }
    }
}
