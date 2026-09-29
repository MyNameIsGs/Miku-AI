// Cómo se muestra cada tool en el rastro de "pensando" de la caja de
// subtítulo (diseño v1, README §3): categoría corta + texto humano en curso
// y terminado. Una tool que no esté acá se muestra con su nombre legible.

type ToolLabel = { category: string; running: string; done: string };

const LABELS: Record<string, ToolLabel> = {
  // Spotify
  buscar_cancion: { category: "SPOTIFY", running: "Buscando la canción…", done: "Buscó la canción" },
  reproducir_cancion: { category: "SPOTIFY", running: "Reproduciendo la canción…", done: "Puso la canción" },
  reproducir_playlist: { category: "SPOTIFY", running: "Reproduciendo playlist…", done: "Puso la playlist" },
  reproducir_album: { category: "SPOTIFY", running: "Reproduciendo el álbum…", done: "Puso el álbum" },
  agregar_a_cola: { category: "SPOTIFY", running: "Agregando a la cola…", done: "Lo agregó a la cola" },
  que_esta_sonando: { category: "SPOTIFY", running: "Mirando qué suena…", done: "Vio qué está sonando" },
  transferir_reproduccion: { category: "SPOTIFY", running: "Pasando la música de equipo…", done: "Pasó la música de equipo" },
  modo_aleatorio: { category: "SPOTIFY", running: "Cambiando el aleatorio…", done: "Cambió el aleatorio" },
  modo_repeticion: { category: "SPOTIFY", running: "Cambiando la repetición…", done: "Cambió la repetición" },

  // Correo y calendario
  revisar_correo: { category: "CORREO", running: "Revisando tu correo…", done: "Revisó tu correo" },
  revisar_calendario: { category: "CALENDARIO", running: "Revisando tu calendario…", done: "Revisó tu calendario" },

  // Web
  buscar_en_web: { category: "WEB", running: "Buscando en internet…", done: "Buscó en internet" },
  abrir_url: { category: "WEB", running: "Abriendo la página…", done: "Abrió la página" },

  // Mapas
  abrir_mapa: { category: "MAPAS", running: "Abriendo Google Maps…", done: "Abrió Google Maps" },
  mi_ubicacion: { category: "MAPAS", running: "Viendo dónde estás…", done: "Vio dónde estás" },
  buscar_lugares: { category: "MAPAS", running: "Buscando lugares…", done: "Buscó lugares" },
  tiempo_de_viaje: { category: "MAPAS", running: "Calculando el viaje…", done: "Calculó el viaje" },

  // Apps y ventanas
  abrir_aplicacion: { category: "APPS", running: "Abriendo la app…", done: "Abrió la app" },
  abrir_carpeta_de_apps: { category: "APPS", running: "Abriendo la carpeta…", done: "Abrió la carpeta de apps" },
  minimizar_ventana: { category: "APPS", running: "Minimizando la ventana…", done: "Minimizó la ventana" },
  mover_ventana: { category: "APPS", running: "Moviendo la ventana…", done: "Movió la ventana" },
  modo_foco: { category: "APPS", running: "Preparando el modo foco…", done: "Activó el modo foco" },
  escribir_texto: { category: "APPS", running: "Escribiendo…", done: "Escribió el texto" },
  buscar_archivos: { category: "ARCHIVOS", running: "Buscando archivos…", done: "Buscó en tus archivos" },

  // Sonido
  ajustar_volumen: { category: "SONIDO", running: "Ajustando el volumen…", done: "Ajustó el volumen" },
  cambiar_salida_audio: { category: "SONIDO", running: "Cambiando la salida de audio…", done: "Cambió la salida de audio" },
  control_medios: { category: "SONIDO", running: "Controlando la reproducción…", done: "Controló la reproducción" },

  // Pendientes y recordatorios
  anotar_pendiente: { category: "PENDIENTES", running: "Anotando el pendiente…", done: "Anotó el pendiente" },
  cerrar_pendiente: { category: "PENDIENTES", running: "Cerrando el pendiente…", done: "Cerró el pendiente" },
  poner_recordatorio: { category: "RECORDATORIO", running: "Poniendo el recordatorio…", done: "Puso el recordatorio" },

  // Ella y la pantalla
  ver_pantalla: { category: "PANTALLA", running: "Mirando tu pantalla…", done: "Miró tu pantalla" },
  mirarme: { category: "CÁMARA", running: "Mirándote…", done: "Te miró" },
  obtener_hora_actual: { category: "HORA", running: "Mirando la hora…", done: "Miró la hora" },
};

// "mcp_playwright_browser_click" → categoría "PLAYWRIGHT", texto "browser click".
function fallbackLabel(name: string): ToolLabel {
  const mcp = name.match(/^mcp_([^_]+)_(.+)$/);
  const category = (mcp ? mcp[1] : "TOOL").toUpperCase();
  const readable = (mcp ? mcp[2] : name).replace(/_/g, " ");
  return { category, running: `${readable}…`, done: readable };
}

export function describeTool(name: string, status: "running" | "done"): { category: string; text: string } {
  const label = LABELS[name] ?? fallbackLabel(name);
  return { category: label.category, text: status === "running" ? label.running : label.done };
}
