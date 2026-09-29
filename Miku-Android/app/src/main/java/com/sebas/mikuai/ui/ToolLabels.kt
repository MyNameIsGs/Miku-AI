package com.sebas.mikuai.ui

// Cómo se muestra cada tool en el rastro de "pensando" (ronda 2 de diseño,
// DISENO.md §6.3): categoría corta + texto humano en curso y terminado.
// Mismos textos que el escritorio (Miku-AI/src/lib/toolLabels.ts); una tool
// que no esté acá se muestra con su nombre legible.

data class ToolLabel(val category: String, val running: String, val done: String)

private val LABELS = mapOf(
    "buscar_cancion" to ToolLabel("SPOTIFY", "Buscando la canción…", "Buscó la canción"),
    "reproducir_cancion" to ToolLabel("SPOTIFY", "Reproduciendo la canción…", "Puso la canción"),
    "reproducir_playlist" to ToolLabel("SPOTIFY", "Reproduciendo playlist…", "Puso la playlist"),
    "reproducir_album" to ToolLabel("SPOTIFY", "Reproduciendo el álbum…", "Puso el álbum"),
    "agregar_a_cola" to ToolLabel("SPOTIFY", "Agregando a la cola…", "Lo agregó a la cola"),
    "que_esta_sonando" to ToolLabel("SPOTIFY", "Mirando qué suena…", "Vio qué está sonando"),
    "transferir_reproduccion" to ToolLabel("SPOTIFY", "Pasando la música de equipo…", "Pasó la música de equipo"),
    "modo_aleatorio" to ToolLabel("SPOTIFY", "Cambiando el aleatorio…", "Cambió el aleatorio"),
    "modo_repeticion" to ToolLabel("SPOTIFY", "Cambiando la repetición…", "Cambió la repetición"),
    "revisar_correo" to ToolLabel("CORREO", "Revisando tu correo…", "Revisó tu correo"),
    "revisar_calendario" to ToolLabel("CALENDARIO", "Revisando tu calendario…", "Revisó tu calendario"),
    "buscar_en_web" to ToolLabel("WEB", "Buscando en internet…", "Buscó en internet"),
    "abrir_mapa" to ToolLabel("MAPAS", "Abriendo Google Maps…", "Abrió Google Maps"),
    "mi_ubicacion" to ToolLabel("MAPAS", "Viendo dónde estás…", "Vio dónde estás"),
    "anotar_pendiente" to ToolLabel("PENDIENTES", "Anotando el pendiente…", "Anotó el pendiente"),
    "cerrar_pendiente" to ToolLabel("PENDIENTES", "Cerrando el pendiente…", "Cerró el pendiente"),
)

fun describeTool(name: String, done: Boolean): Pair<String, String> {
    val label = LABELS[name] ?: run {
        val readable = name.replace('_', ' ')
        ToolLabel("TOOL", "$readable…", readable)
    }
    return label.category to (if (done) label.done else label.running)
}
