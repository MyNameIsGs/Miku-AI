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
                    put("condicion", JSONObject().apply {
                        put("type", "string")
                        put("description", "Opcional. Úsala SOLO si esto es algo que se puede verificar buscando en la web y cambia con el tiempo (ej. \"el pasaje a Japón baja de \$800\", \"sale una fecha para el próximo álbum de tal artista\"). En ese caso lo revisas sola de vez en cuando con una búsqueda real, y avisas cuando se cumpla. No la uses para cosas que Sebastián simplemente te contó que van a pasar -- para eso alcanza con descripcion y fecha_estimada.")
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
        put(
            buildTool(
                name = "buscar_cancion",
                description = "Busca canciones en Spotify por nombre, artista, o ambos, sin reproducir nada. Úsala cuando Sebastián quiera saber qué opciones hay antes de elegir una.",
                properties = JSONObject().apply {
                    put("consulta", JSONObject().apply {
                        put("type", "string")
                        put("description", "Qué buscar, por ejemplo \"bad apple\" o \"canciones de Kikuo\".")
                    })
                },
                required = listOf("consulta"),
            )
        )
        put(
            buildTool(
                name = "reproducir_cancion",
                description = "Busca una canción en Spotify por nombre/artista y la pone a sonar de inmediato en el dispositivo de Spotify activo de Sebastián (necesita tener Spotify abierto en algún lado). Úsala cuando pida escuchar algo puntual, no solo buscar información.",
                properties = JSONObject().apply {
                    put("consulta", JSONObject().apply {
                        put("type", "string")
                        put("description", "La canción a reproducir, por ejemplo \"bad apple\" o \"melt de Kikuo\".")
                    })
                },
                required = listOf("consulta"),
            )
        )
        put(
            buildTool(
                name = "reproducir_playlist",
                description = "Busca una playlist de Spotify por nombre y la pone a sonar completa (en orden) en el dispositivo de Spotify activo de Sebastián. Úsala cuando pida una playlist puntual, no una canción suelta.",
                properties = JSONObject().apply {
                    put("consulta", JSONObject().apply {
                        put("type", "string")
                        put("description", "El nombre de la playlist a reproducir, por ejemplo \"mi playlist de gym\" o \"lofi beats\".")
                    })
                },
                required = listOf("consulta"),
            )
        )
        put(
            buildTool(
                name = "reproducir_album",
                description = "Busca un álbum de Spotify por nombre/artista y lo pone a sonar completo (en orden) en el dispositivo de Spotify activo de Sebastián. Úsala cuando pida un álbum puntual, no una canción suelta.",
                properties = JSONObject().apply {
                    put("consulta", JSONObject().apply {
                        put("type", "string")
                        put("description", "El álbum a reproducir, por ejemplo \"the dark side of the moon\" o \"melancolía de Kikuo\".")
                    })
                },
                required = listOf("consulta"),
            )
        )
        put(
            buildTool(
                name = "agregar_a_cola",
                description = "Busca una canción en Spotify y la agrega a la cola de reproducción, sin interrumpir lo que esté sonando ahora. Úsala cuando pida que algo suene DESPUÉS, no de inmediato -- para eso está reproducir_cancion.",
                properties = JSONObject().apply {
                    put("consulta", JSONObject().apply {
                        put("type", "string")
                        put("description", "La canción a agregar a la cola, por ejemplo \"bad apple\".")
                    })
                },
                required = listOf("consulta"),
            )
        )
        put(
            buildTool(
                name = "que_esta_sonando",
                description = "Consulta qué canción está sonando ahora mismo en Spotify (nombre y artista), y si está en pausa o reproduciéndose.",
                properties = JSONObject(),
                required = emptyList(),
            )
        )
        put(
            buildTool(
                name = "transferir_reproduccion",
                description = "Mueve la reproducción de Spotify a otro dispositivo (por ejemplo, del celular a la PC o viceversa), sin cortar lo que esté sonando.",
                properties = JSONObject().apply {
                    put("dispositivo", JSONObject().apply {
                        put("type", "string")
                        put("description", "A qué dispositivo mover la reproducción, por ejemplo \"PC\" o \"celular\" -- no hace falta el nombre exacto.")
                    })
                },
                required = listOf("dispositivo"),
            )
        )
        put(
            buildTool(
                name = "modo_aleatorio",
                description = "Activa o desactiva el modo aleatorio de Spotify para lo que esté sonando ahora. Reproducir algo no lo pone en aleatorio por sí solo -- si Sebastián lo pide combinado con una playlist, usa esta tool además de reproducir_playlist.",
                properties = JSONObject().apply {
                    put("activar", JSONObject().apply {
                        put("type", "boolean")
                        put("description", "true para activar el modo aleatorio, false para desactivarlo.")
                    })
                },
                required = listOf("activar"),
            )
        )
        put(
            buildTool(
                name = "modo_repeticion",
                description = "Cambia el modo de repetición de Spotify: repetir solo la canción actual en loop, repetir toda la playlist/álbum, o apagar la repetición.",
                properties = JSONObject().apply {
                    put("modo", JSONObject().apply {
                        put("type", "string")
                        put("enum", JSONArray(listOf("cancion", "lista", "apagado")))
                        put("description", "\"cancion\" repite el track actual en loop, \"lista\" repite toda la playlist/álbum, \"apagado\" la desactiva.")
                    })
                },
                required = listOf("modo"),
            )
        )
        // Tarea 6.3: misma tool que lib/tools/buscarEnWeb.ts de desktop
        // (ver BuscarEnWeb.kt).
        put(
            buildTool(
                name = "buscar_en_web",
                description = "Busca en internet información actual o que no sepas de memoria (noticias, datos recientes, precios de referencia, temas puntuales). No sirve para precios en vivo ni para reservar nada -- devuelve un resumen de lo que se encontró, con fuentes.",
                properties = JSONObject().apply {
                    put("consulta", JSONObject().apply {
                        put("type", "string")
                        put("description", "Qué buscar, en pocas palabras, como se escribiría en un buscador.")
                    })
                },
                required = listOf("consulta"),
            )
        )
        put(
            buildTool(
                name = "revisar_correo",
                description = "Revisa los correos más recientes de TODAS las cuentas de Gmail que Sebastián tenga conectadas -- solo lectura, nunca envía, borra ni modifica nada. Devuelve de qué cuenta vino cada uno, remitente, asunto, fecha y un fragmento corto. Úsala cuando Sebastián pida revisar el correo, o cuando quieras fijarte si llegó algo con una fecha de entrega o cita que valga la pena anotar con anotar_pendiente.",
                properties = JSONObject().apply {
                    put("dias", JSONObject().apply {
                        put("type", "number")
                        put("description", "Cuántos días hacia atrás revisar. Por defecto 7.")
                    })
                },
                required = emptyList(),
            )
        )
        put(
            buildTool(
                name = "revisar_calendario",
                description = "Revisa los próximos eventos de TODOS los calendarios de Google que Sebastián tenga conectados -- solo lectura, nunca crea, edita ni borra nada. Devuelve de qué cuenta es cada evento, título, cuándo empieza y el lugar si tiene. Úsala cuando Sebastián pregunte qué tiene agendado, o quieras revisar si hay algo próximo que valga la pena mencionar.",
                properties = JSONObject().apply {
                    put("dias", JSONObject().apply {
                        put("type", "number")
                        put("description", "Cuántos días hacia adelante revisar. Por defecto 7.")
                    })
                },
                required = emptyList(),
            )
        )
    }

    suspend fun execute(
        name: String,
        argumentsJson: String,
        pendientes: PendientesRepository,
        spotify: SpotifyApi,
        gmail: GmailApi,
        calendar: CalendarApi,
        openRouter: OpenRouterApi,
    ): String {
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
                    if (args.has("condicion") && !args.isNull("condicion")) args.getString("condicion") else null,
                )
                "cerrar_pendiente" -> pendientes.cerrarPendiente(args.getString("descripcion"))
                "buscar_cancion" -> {
                    val consulta = args.getString("consulta")
                    val tracks = spotify.searchTracks(consulta, 5)
                    if (tracks.isEmpty()) {
                        "No encontré ninguna canción para \"$consulta\"."
                    } else {
                        tracks.joinToString("\n") { "${it.name} - ${it.artists}" }
                    }
                }
                "reproducir_cancion" -> {
                    val consulta = args.getString("consulta")
                    val tracks = spotify.searchTracks(consulta, 1)
                    if (tracks.isEmpty()) {
                        "No encontré ninguna canción para \"$consulta\"."
                    } else {
                        val top = tracks[0]
                        spotify.playTrack(top.uri)
                        "Reproduciendo \"${top.name}\" de ${top.artists}."
                    }
                }
                "reproducir_playlist" -> {
                    val consulta = args.getString("consulta")
                    val playlist = spotify.findPlaylist(consulta)
                    if (playlist == null) {
                        "No encontré ninguna playlist para \"$consulta\"."
                    } else {
                        spotify.playContext(playlist.uri)
                        "Reproduciendo la playlist \"${playlist.name}\"" +
                            if (playlist.owner.isNotBlank()) " de ${playlist.owner}." else "."
                    }
                }
                "reproducir_album" -> {
                    val consulta = args.getString("consulta")
                    val albums = spotify.searchAlbums(consulta, 1)
                    if (albums.isEmpty()) {
                        "No encontré ningún álbum para \"$consulta\"."
                    } else {
                        val top = albums[0]
                        spotify.playContext(top.uri)
                        "Reproduciendo el álbum \"${top.name}\" de ${top.artists}."
                    }
                }
                "agregar_a_cola" -> {
                    val consulta = args.getString("consulta")
                    val tracks = spotify.searchTracks(consulta, 1)
                    if (tracks.isEmpty()) {
                        "No encontré ninguna canción para \"$consulta\"."
                    } else {
                        val top = tracks[0]
                        spotify.addToQueue(top.uri)
                        "Agregué \"${top.name}\" de ${top.artists} a la cola."
                    }
                }
                "que_esta_sonando" -> {
                    val nowPlaying = spotify.getNowPlaying()
                    if (nowPlaying.track == null) {
                        "No hay ninguna canción sonando en Spotify ahora mismo."
                    } else {
                        val estado = if (nowPlaying.isPlaying) "sonando" else "en pausa"
                        "\"${nowPlaying.track}\" de ${nowPlaying.artists ?: "un artista desconocido"} -- $estado."
                    }
                }
                "transferir_reproduccion" -> {
                    val dispositivo = args.getString("dispositivo")
                    val nombre = spotify.transferPlayback(dispositivo)
                    "Listo, la reproducción ahora está en \"$nombre\"."
                }
                "modo_aleatorio" -> {
                    val activar = args.getBoolean("activar")
                    spotify.setShuffle(activar)
                    if (activar) "Modo aleatorio activado." else "Modo aleatorio desactivado."
                }
                "modo_repeticion" -> {
                    val modo = args.getString("modo")
                    val spotifyMode = when (modo) {
                        "cancion" -> "track"
                        "lista" -> "context"
                        "apagado" -> "off"
                        else -> return "Error: modo de repetición desconocido \"$modo\"."
                    }
                    spotify.setRepeat(spotifyMode)
                    when (modo) {
                        "cancion" -> "Repitiendo la canción actual."
                        "lista" -> "Repitiendo toda la lista."
                        else -> "Repetición desactivada."
                    }
                }
                "buscar_en_web" -> BuscarEnWeb.execute(openRouter, args.optString("consulta", ""))
                "revisar_correo" -> {
                    val dias = if (args.has("dias") && args.get("dias") is Number) {
                        args.getInt("dias").coerceAtLeast(1)
                    } else {
                        7
                    }
                    val messages = gmail.listRecentMessagesAllAccounts(15, dias)
                    if (messages.isEmpty()) {
                        "No hay correos nuevos en los últimos $dias días."
                    } else {
                        messages.joinToString("\n---\n") {
                            "Cuenta: ${it.account}\nDe: ${it.from}\nAsunto: ${it.subject}\nFecha: ${it.date}\nFragmento: ${it.snippet}"
                        }
                    }
                }
                "revisar_calendario" -> {
                    val dias = if (args.has("dias") && args.get("dias") is Number) {
                        args.getInt("dias").coerceAtLeast(1)
                    } else {
                        7
                    }
                    val events = calendar.listUpcomingEventsAllAccounts(dias, 15)
                    if (events.isEmpty()) {
                        "No hay eventos agendados en los próximos $dias días."
                    } else {
                        events.joinToString("\n---\n") {
                            "Cuenta: ${it.account}\nEvento: ${it.summary}\nCuándo: ${it.start}" +
                                if (it.location.isNotBlank()) "\nLugar: ${it.location}" else ""
                        }
                    }
                }
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
