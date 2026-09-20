package com.sebas.mikuai.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

data class SpotifyTrack(val name: String, val artists: String, val uri: String)
data class SpotifyPlaylist(val name: String, val owner: String, val uri: String)
data class SpotifyAlbum(val name: String, val artists: String, val uri: String)
data class SpotifyNowPlaying(val isPlaying: Boolean, val track: String?, val artists: String?)

private data class SpotifyDevice(val id: String, val name: String, val isActive: Boolean)

class SpotifyApi(private val auth: SpotifyAuth) {

    private val client = OkHttpClient()

    private suspend fun authorizedRequest(
        url: String,
        method: String = "GET",
        body: okhttp3.RequestBody? = null,
    ): Response {
        val token = auth.getValidAccessToken()
            ?: throw IllegalStateException(
                "Spotify no está conectado -- Sebastián tiene que conectarlo primero desde Configuración.",
            )
        val builder = Request.Builder().url(url).addHeader("Authorization", "Bearer $token")
        when (method) {
            "PUT" -> builder.put(body ?: ByteArray(0).toRequestBody(null))
            "POST" -> builder.post(body ?: ByteArray(0).toRequestBody(null))
            else -> {}
        }
        return withContext(Dispatchers.IO) { client.newCall(builder.build()).execute() }
    }

    suspend fun searchTracks(query: String, limit: Int = 5): List<SpotifyTrack> {
        val encoded = URLEncoder.encode(query, "UTF-8")
        val response = authorizedRequest("https://api.spotify.com/v1/search?q=$encoded&type=track&limit=$limit")
        if (!response.isSuccessful) {
            throw IllegalStateException("Error buscando en Spotify: ${response.body?.string()}")
        }
        val items = JSONObject(response.body!!.string()).getJSONObject("tracks").getJSONArray("items")
        return (0 until items.length()).map { i ->
            val item = items.getJSONObject(i)
            val artistsArray = item.getJSONArray("artists")
            val artists = (0 until artistsArray.length())
                .joinToString(", ") { artistsArray.getJSONObject(it).getString("name") }
            SpotifyTrack(item.getString("name"), artists, item.getString("uri"))
        }
    }

    // Playlists/álbumes: se busca solo para reproducir el primer resultado
    // directo, sin una tool separada de "solo buscar" -- pedir una
    // playlist o álbum puntual suele ser menos ambiguo que un título de
    // canción.
    suspend fun searchPlaylists(query: String, limit: Int = 1): List<SpotifyPlaylist> {
        val encoded = URLEncoder.encode(query, "UTF-8")
        val response = authorizedRequest("https://api.spotify.com/v1/search?q=$encoded&type=playlist&limit=$limit")
        if (!response.isSuccessful) {
            throw IllegalStateException("Error buscando playlists en Spotify: ${response.body?.string()}")
        }
        val items = JSONObject(response.body!!.string()).getJSONObject("playlists").getJSONArray("items")
        val result = mutableListOf<SpotifyPlaylist>()
        for (i in 0 until items.length()) {
            // La API puede devolver entradas null (playlists borradas o ya
            // no disponibles).
            val item = items.optJSONObject(i) ?: continue
            val owner = item.optJSONObject("owner")?.optString("display_name", "") ?: ""
            result.add(SpotifyPlaylist(item.getString("name"), owner, item.getString("uri")))
        }
        return result
    }

    // Playlists propias (dueño o seguidas) -- la búsqueda pública de
    // Spotify apenas indexa contenido privado del usuario, así que para
    // reproducir_playlist conviene buscar acá primero por coincidencia de
    // texto (mismo criterio que cerrar_pendiente: el código hace el
    // matching, no un id opaco) en vez de confiar en /search.
    private suspend fun listMyPlaylists(): List<SpotifyPlaylist> {
        val result = mutableListOf<SpotifyPlaylist>()
        var url: String? = "https://api.spotify.com/v1/me/playlists?limit=50"

        while (url != null) {
            val response = authorizedRequest(url)
            if (!response.isSuccessful) {
                throw IllegalStateException("Error listando tus playlists de Spotify: ${response.body?.string()}")
            }
            val json = JSONObject(response.body!!.string())
            val items = json.getJSONArray("items")
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                val owner = item.optJSONObject("owner")?.optString("display_name", "") ?: ""
                result.add(SpotifyPlaylist(item.getString("name"), owner, item.getString("uri")))
            }
            url = if (json.isNull("next")) null else json.getString("next")
        }

        return result
    }

    // Busca primero entre las playlists propias/seguidas de Sebastián por
    // coincidencia parcial de nombre; si no encuentra nada ahí, recién cae
    // a la búsqueda pública de Spotify (para playlists editoriales que
    // nunca siguió, ej. "Viral Hits").
    suspend fun findPlaylist(query: String): SpotifyPlaylist? {
        val normalized = query.trim().lowercase()
        if (normalized.isEmpty()) return null

        val mine = listMyPlaylists()
        val ownMatch = mine.firstOrNull { it.name.lowercase().contains(normalized) }
        if (ownMatch != null) return ownMatch

        return searchPlaylists(query, 1).firstOrNull()
    }

    suspend fun searchAlbums(query: String, limit: Int = 1): List<SpotifyAlbum> {
        val encoded = URLEncoder.encode(query, "UTF-8")
        val response = authorizedRequest("https://api.spotify.com/v1/search?q=$encoded&type=album&limit=$limit")
        if (!response.isSuccessful) {
            throw IllegalStateException("Error buscando álbumes en Spotify: ${response.body?.string()}")
        }
        val items = JSONObject(response.body!!.string()).getJSONObject("albums").getJSONArray("items")
        return (0 until items.length()).map { i ->
            val item = items.getJSONObject(i)
            val artistsArray = item.getJSONArray("artists")
            val artists = (0 until artistsArray.length())
                .joinToString(", ") { artistsArray.getJSONObject(it).getString("name") }
            SpotifyAlbum(item.getString("name"), artists, item.getString("uri"))
        }
    }

    private suspend fun listDevices(): List<SpotifyDevice> {
        val response = authorizedRequest("https://api.spotify.com/v1/me/player/devices")
        if (!response.isSuccessful) {
            throw IllegalStateException("Error consultando dispositivos de Spotify: ${response.body?.string()}")
        }
        val devices = JSONObject(response.body!!.string()).getJSONArray("devices")
        return (0 until devices.length()).map {
            val d = devices.getJSONObject(it)
            SpotifyDevice(d.getString("id"), d.getString("name"), d.getBoolean("is_active"))
        }
    }

    // Mismo gotcha ya encontrado en desktop (ver 6.23 del contexto): un
    // dispositivo recién abierto puede tardar unos segundos en aparecer
    // ante la API -- reintenta con espera antes de rendirse.
    private suspend fun waitForDevices(maxAttempts: Int = 4, delayMs: Long = 1500): List<SpotifyDevice> {
        repeat(maxAttempts) { attempt ->
            val devices = listDevices()
            if (devices.isNotEmpty()) return devices
            if (attempt < maxAttempts - 1) delay(delayMs)
        }
        return emptyList()
    }

    private suspend fun putPlay(bodyJson: JSONObject, deviceId: String?): Response {
        val query = if (deviceId != null) "?device_id=$deviceId" else ""
        val body = bodyJson.toString().toRequestBody("application/json".toMediaType())
        return authorizedRequest("https://api.spotify.com/v1/me/player/play$query", "PUT", body)
    }

    // Mismos dos arreglos que en desktop: pedir la lista de dispositivos
    // (con reintento) y mandar el device_id explícito en vez de confiar en
    // que la API elija uno sola, más mensajes de error que dejan explícito
    // que reintentar la tool no cambia nada. Compartido por playTrack
    // (uris) y playContext (context_uri) -- mismo endpoint, mismo problema
    // de dispositivo, solo cambia el cuerpo.
    private suspend fun playWithDeviceFallback(bodyJson: JSONObject) {
        var response = putPlay(bodyJson, null)

        if (response.code == 404) {
            val devices = waitForDevices()
            if (devices.isEmpty()) {
                throw IllegalStateException(
                    "No hay ningún dispositivo de Spotify abierto en ningún lado. Esto no se arregla reintentando la herramienta -- hay que abrir Spotify (la app, el celular, o open.spotify.com) en algún dispositivo primero.",
                )
            }
            val target = devices.firstOrNull { it.isActive } ?: devices.first()
            response = putPlay(bodyJson, target.id)
        }

        if (!response.isSuccessful && response.code != 204) {
            throw IllegalStateException(
                "Error al reproducir en Spotify (esto no se arregla reintentando la herramienta): ${response.body?.string()}",
            )
        }
    }

    suspend fun playTrack(uri: String) {
        playWithDeviceFallback(JSONObject().put("uris", JSONArray().put(uri)))
    }

    // Playlists y álbumes se reproducen como "contexto" (context_uri), no
    // como uris individuales -- deja sonando la colección completa en
    // orden, no solo un track suelto.
    suspend fun playContext(contextUri: String) {
        playWithDeviceFallback(JSONObject().put("context_uri", contextUri))
    }

    // Agrega una canción a continuación de la cola actual, sin
    // interrumpir lo que esté sonando -- distinto de playTrack, que corta
    // lo que suena y arranca de inmediato.
    suspend fun addToQueue(uri: String) {
        val encoded = URLEncoder.encode(uri, "UTF-8")
        val response = authorizedRequest("https://api.spotify.com/v1/me/player/queue?uri=$encoded", "POST")
        if (response.code == 404) {
            throw IllegalStateException(
                "No hay ningún dispositivo de Spotify activo para agregar a la cola -- hay que abrir Spotify en algún lado primero.",
            )
        }
        if (!response.isSuccessful && response.code != 204) {
            throw IllegalStateException("Error agregando a la cola de Spotify: ${response.body?.string()}")
        }
    }

    // Transfiere la reproducción a otro dispositivo de Spotify (por
    // nombre parcial, mismo criterio de matching por texto que el resto
    // del proyecto), sin cortar lo que esté sonando -- útil en un
    // proyecto que tiene Spotify integrado en más de un dispositivo
    // (desktop y Android). Devuelve el nombre real del dispositivo
    // encontrado, para confirmárselo a Sebastián.
    suspend fun transferPlayback(deviceQuery: String): String {
        val devices = waitForDevices()
        if (devices.isEmpty()) {
            throw IllegalStateException("No hay ningún dispositivo de Spotify disponible para transferir la reproducción.")
        }
        val normalized = deviceQuery.trim().lowercase()
        val match = devices.firstOrNull { it.name.lowercase().contains(normalized) }
            ?: throw IllegalStateException(
                "No encontré ningún dispositivo de Spotify llamado \"$deviceQuery\". Dispositivos disponibles: " +
                    devices.joinToString(", ") { it.name } + ".",
            )

        val bodyJson = JSONObject().apply {
            put("device_ids", JSONArray().put(match.id))
            put("play", true)
        }
        val body = bodyJson.toString().toRequestBody("application/json".toMediaType())
        val response = authorizedRequest("https://api.spotify.com/v1/me/player", "PUT", body)
        if (!response.isSuccessful && response.code != 204) {
            throw IllegalStateException("Error transfiriendo la reproducción en Spotify: ${response.body?.string()}")
        }
        return match.name
    }

    suspend fun setShuffle(enabled: Boolean) {
        val response = authorizedRequest("https://api.spotify.com/v1/me/player/shuffle?state=$enabled", "PUT")
        if (response.code == 404) {
            throw IllegalStateException(
                "No hay ningún dispositivo de Spotify activo para cambiar el modo aleatorio -- hay que abrir Spotify primero.",
            )
        }
        if (!response.isSuccessful && response.code != 204) {
            throw IllegalStateException("Error cambiando el modo aleatorio en Spotify: ${response.body?.string()}")
        }
    }

    // "track" repite la canción actual en loop, "context" repite la
    // playlist/álbum completo, "off" apaga la repetición.
    suspend fun setRepeat(mode: String) {
        val response = authorizedRequest("https://api.spotify.com/v1/me/player/repeat?state=$mode", "PUT")
        if (response.code == 404) {
            throw IllegalStateException(
                "No hay ningún dispositivo de Spotify activo para cambiar la repetición -- hay que abrir Spotify primero.",
            )
        }
        if (!response.isSuccessful && response.code != 204) {
            throw IllegalStateException("Error cambiando la repetición en Spotify: ${response.body?.string()}")
        }
    }

    // Qué está sonando ahora mismo -- 204 sin cuerpo es la respuesta real
    // de Spotify cuando no hay nada reproduciéndose, no un error.
    suspend fun getNowPlaying(): SpotifyNowPlaying {
        val response = authorizedRequest("https://api.spotify.com/v1/me/player/currently-playing")
        if (response.code == 204) {
            return SpotifyNowPlaying(isPlaying = false, track = null, artists = null)
        }
        if (!response.isSuccessful) {
            throw IllegalStateException("Error consultando qué está sonando en Spotify: ${response.body?.string()}")
        }
        val json = JSONObject(response.body!!.string())
        val item = json.optJSONObject("item")
            ?: return SpotifyNowPlaying(isPlaying = false, track = null, artists = null)
        val artistsArray = item.optJSONArray("artists")
        val artists = if (artistsArray != null && artistsArray.length() > 0) {
            (0 until artistsArray.length()).joinToString(", ") { artistsArray.getJSONObject(it).getString("name") }
        } else {
            null
        }
        val trackName = if (item.has("name") && !item.isNull("name")) item.getString("name") else null
        return SpotifyNowPlaying(
            isPlaying = json.optBoolean("is_playing", false),
            track = trackName,
            artists = artists,
        )
    }
}
