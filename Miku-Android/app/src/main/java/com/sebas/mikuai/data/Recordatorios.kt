package com.sebas.mikuai.data

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.sebas.mikuai.wakeword.RecordatorioReceiver
import org.json.JSONArray
import org.json.JSONObject

/**
 * Tool poner_recordatorio en Android (2026-10-25), la misma que
 * lib/tools/ponerRecordatorio.ts de desktop: un timer de corto plazo
 * (minutos/horas), distinto de anotar_pendiente (días, por GitHub).
 *
 * Cada recordatorio es una alarma exacta del sistema (suena aunque la app
 * esté cerrada) y queda guardado acá, para volver a programarlo si el
 * teléfono se reinicia (BootReceiver) -- mismo espíritu que D6 de desktop,
 * donde sobrevive a cerrar la app. Al sonar, RecordatorioReceiver lo avisa.
 */
object Recordatorios {

    private const val PREFS = "recordatorios"
    private const val KEY = "lista"
    const val EXTRA_ID = "recordatorio_id"
    const val MAX_MINUTOS = 24 * 60

    fun execute(context: Context, args: JSONObject): String {
        val minutos = args.optDouble("minutos", Double.NaN)
        val mensaje = args.optString("mensaje", "").trim()
        if (minutos.isNaN() || minutos <= 0) return "Error: los minutos tienen que ser un número mayor a 0."
        if (minutos > MAX_MINUTOS) {
            return "Error: no uses recordatorios de más de 24 horas -- para algo tan lejano, usa anotar_pendiente con una fecha."
        }
        if (mensaje.isEmpty()) return "Error: falta el mensaje del recordatorio."

        val at = System.currentTimeMillis() + (minutos * 60_000).toLong()
        val id = (at % Int.MAX_VALUE).toInt()
        save(context, load(context).put(JSONObject().apply {
            put("id", id); put("at", at); put("mensaje", mensaje)
        }))
        schedule(context, id, at)
        val n = if (minutos % 1.0 == 0.0) minutos.toLong().toString() else minutos.toString()
        return "Recordatorio puesto para dentro de $n minuto${if (n == "1") "" else "s"}."
    }

    /** Saca el recordatorio de la lista y devuelve su mensaje (null si ya no estaba). */
    fun take(context: Context, id: Int): String? {
        val list = load(context)
        val kept = JSONArray()
        var mensaje: String? = null
        for (i in 0 until list.length()) {
            val r = list.getJSONObject(i)
            if (r.getInt("id") == id) mensaje = r.getString("mensaje") else kept.put(r)
        }
        save(context, kept)
        return mensaje
    }

    /** Tras un reinicio las alarmas se pierden: se vuelven a programar (las vencidas, ya). */
    fun rescheduleAll(context: Context) {
        val list = load(context)
        val now = System.currentTimeMillis()
        for (i in 0 until list.length()) {
            val r = list.getJSONObject(i)
            schedule(context, r.getInt("id"), maxOf(r.getLong("at"), now + 5_000))
        }
    }

    private fun schedule(context: Context, id: Int, at: Long) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val pending = PendingIntent.getBroadcast(
            context, id,
            Intent(context, RecordatorioReceiver::class.java).putExtra(EXTRA_ID, id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // USE_EXACT_ALARM (manifest) la concede sola en Android 13+; si por
        // algo no está, una inexacta igual llega, con unos minutos de margen.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        }
    }

    private fun load(context: Context): JSONArray = try {
        JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"))
    } catch (e: Exception) {
        JSONArray()
    }

    // commit (no apply): si el proceso muere justo después de poner el
    // recordatorio, apply() lo perdía y la alarma sonaba sin mensaje
    // (pasó en la primera prueba, 2026-10-25).
    private fun save(context: Context, list: JSONArray) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, list.toString()).commit()
    }
}
