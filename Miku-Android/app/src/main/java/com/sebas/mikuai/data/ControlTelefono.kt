package com.sebas.mikuai.data

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.SystemClock
import android.view.KeyEvent
import org.json.JSONObject
import java.text.Normalizer
import kotlin.math.roundToInt

/**
 * Las versiones de celular de cuatro tools de desktop (2026-10-25), con el
 * mismo nombre y los mismos parámetros para que Miku las use igual en los
 * dos lados: control_medios y ajustar_volumen (Tarea 6.4 allá, teclas
 * multimedia y Core Audio), abrir_url y abrir_aplicacion (Tareas 6.2/6.3).
 *
 * Abrir pantallas funciona también desde "Hey Miku" por el mismo motivo que
 * abrir_mapa (ver Tools.kt): "mostrar sobre otras apps" exime a la app del
 * límite de Android para abrir pantallas desde segundo plano.
 */
object ControlTelefono {

    val ACCIONES_MEDIOS = listOf("play_pausa", "siguiente", "anterior")
    val ACCIONES_VOLUMEN = listOf("subir", "bajar", "establecer", "silenciar", "desilenciar")

    // Teclas multimedia virtuales: van a lo que esté sonando (Spotify,
    // YouTube, un podcast), sin saber qué app es -- igual que en desktop.
    fun controlMedios(context: Context, args: JSONObject): String {
        val accion = args.optString("accion", "")
        val keyCode = when (accion) {
            "play_pausa" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            "siguiente" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "anterior" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> return "Error: acción de medios desconocida \"$accion\"."
        }
        val audio = context.getSystemService(AudioManager::class.java)
        val now = SystemClock.uptimeMillis()
        audio.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0))
        audio.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0))
        return "Listo: $accion."
    }

    // Volumen multimedia (el de la música y el de la voz de Miku).
    fun ajustarVolumen(context: Context, args: JSONObject): String {
        val accion = args.optString("accion", "")
        if (accion !in ACCIONES_VOLUMEN) return "Error: acción de volumen desconocida \"$accion\"."
        val audio = context.getSystemService(AudioManager::class.java)
        val stream = AudioManager.STREAM_MUSIC
        val max = audio.getStreamMaxVolume(stream)
        val nivel = if (args.has("nivel") && args.get("nivel") is Number) args.getDouble("nivel") else null

        when (accion) {
            "silenciar" -> {
                audio.adjustStreamVolume(stream, AudioManager.ADJUST_MUTE, 0)
                return "Sonido silenciado."
            }
            "desilenciar" -> {
                audio.adjustStreamVolume(stream, AudioManager.ADJUST_UNMUTE, 0)
                return "Sonido reactivado."
            }
        }
        val current = audio.getStreamVolume(stream) * 100.0 / max
        val target = when (accion) {
            "establecer" -> nivel ?: return "Error: falta el nivel para establecer el volumen."
            "subir" -> current + (nivel ?: 10.0)
            else -> current - (nivel ?: 10.0)
        }.coerceIn(0.0, 100.0)
        if (audio.isStreamMute(stream)) audio.adjustStreamVolume(stream, AudioManager.ADJUST_UNMUTE, 0)
        audio.setStreamVolume(stream, (target / 100 * max).roundToInt(), 0)
        return "Volumen ahora en ${(audio.getStreamVolume(stream) * 100.0 / max).roundToInt()}%."
    }

    fun abrirUrl(context: Context, args: JSONObject): String {
        var url = args.optString("url", "").trim()
        if (url.isEmpty()) return "Error: no se especificó qué URL abrir."
        if (!url.contains("://")) url = "https://$url"
        return try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            "Abrí $url."
        } catch (e: ActivityNotFoundException) {
            "Error: no hay ninguna app para abrir $url."
        }
    }

    /**
     * En desktop la lista de apps va en la descripción de la tool y el
     * modelo elige; acá son más de cien y viajarían en CADA consulta, así
     * que se busca por nombre en el código y solo si no aparece se le pasa
     * la lista a Miku, en el resultado.
     */
    fun abrirAplicacion(context: Context, args: JSONObject): String {
        val nombre = args.optString("nombre", "").trim()
        if (nombre.isEmpty()) return "Error: no se especificó qué aplicación abrir."
        val pm = context.packageManager
        val apps = pm.queryIntentActivities(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0
        ).map { it.loadLabel(pm).toString() to it.activityInfo.packageName }
            .filter { it.second != context.packageName }
            .distinctBy { it.second }

        // Exacto, después que empiece igual, después palabra entera en
        // cualquiera de los dos sentidos ("cámara de fotos" → "Cámara").
        // Nunca un pedazo de palabra: "zzz-no-existe" abría "X" (2026-10-25).
        val wanted = fold(nombre)
        fun wholeWord(haystack: String, needle: String) =
            needle.length >= 2 && Regex("(^|[^a-z0-9])${Regex.escape(needle)}($|[^a-z0-9])").containsMatchIn(haystack)
        val match = apps.firstOrNull { fold(it.first) == wanted }
            ?: apps.filter { wanted.length >= 2 && fold(it.first).startsWith(wanted) }.minByOrNull { it.first.length }
            ?: apps.filter { wholeWord(fold(it.first), wanted) || wholeWord(wanted, fold(it.first)) }.minByOrNull { it.first.length }
            ?: return "No encontré una aplicación llamada \"$nombre\". Las que hay: " +
                apps.map { it.first }.sorted().joinToString(", ") +
                ". Si alguna es la que pidió, vuelve a llamar con ese nombre exacto."

        val launch = pm.getLaunchIntentForPackage(match.second)
            ?: return "Error: \"${match.first}\" no se puede abrir directamente."
        return try {
            context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            "Abrí \"${match.first}\"."
        } catch (e: Exception) {
            "Error al abrir \"${match.first}\": ${e.message}"
        }
    }

    private fun fold(text: String): String =
        Normalizer.normalize(text.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").trim()
}
