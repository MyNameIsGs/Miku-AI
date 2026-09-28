# Miku-AI — Brief para la ronda 2 de diseño

Para Claude Design. La ronda 1 (`docs/diseno-ui-v1/`) ya está implementada en la app de escritorio. Este documento cuenta cómo quedó en la práctica, qué reglas salieron de probarla en vivo y qué falta diseñar: **las pantallas de escritorio que no se cubrieron** y **el rediseño completo de la app de Android, con ícono nuevo**.

Formato de entrega que funcionó en la ronda 1: maquetas (`.dc.html`) + un README con valores exactos en tablas (tokens, tamaños, posiciones, estados). Mantén el mismo formato.

---

## 1. Reglas confirmadas por Sebastián (no cambian)

- **La ventana de escritorio es transparente y flota sobre el escritorio**, siempre encima, en una esquina. Nada de fondos opacos de pantalla completa: la UI tiene que estorbar lo menos posible lo que hay detrás. Diseña pensando en que detrás puede haber **cualquier cosa**, incluido un fondo claro o una ventana blanca (las maquetas de la ronda 1 se veían siempre sobre #12161a y no mostraban ese caso).
- **La barra superior y el panel de escribir aparecen solo al pasar el mouse** por encima de la ventana. Sin mouse, se ve Miku sola, más el subtítulo si está hablando o respondió.
  - Excepción del panel de escribir: se queda visible mientras hay una charla en curso (escuchando / pensando / hablando), si hay algo escrito o adjunto, o si el campo tiene el foco.
- **Texto de Miku pequeño.** La maqueta pedía 24 px al hablar; en vivo se vio enorme y quedó en **16 px** (la transcripción de lo que él dice va a 21 px). Tenlo en cuenta como escala general: esta es una ventana chica en una esquina, no una app a pantalla completa.
- Sin insignia de "hablando" (redundante: ya se ve la boca y el texto).
- Iconos SVG de trazo, nunca emoji.
- Español neutro con tuteo, sin voseo.
- Estética "idol / Vocaloid" de la ronda 1: turquesa #39C5BB + rosa #F0508F, vidrio oscuro, Dela Gothic One / Chakra Petch / Zen Kaku Gothic New. Los tokens exactos están en `docs/diseno-ui-v1/README.md` §2 y en `Miku-AI/src/App.css` (`:root`, variables `--m-*`).

## 2. Cómo quedó la ronda 1 (diferencias con las maquetas)

| Pieza | Qué se hizo | Por qué |
|---|---|---|
| Elipses de escenario | **No se hicieron** | La cámara encuadra a Miku **de la cintura para arriba**: sus pies no se ven. No diseñes nada que dependa de verla de cuerpo entero. |
| Barra | Botones: Cámara (menú) · Bloquear · Apps · Memoria · Configuración · Voz · \| Cerrar. Sin Minimizar. | Bloquear (click-through) se usa mucho: botón propio. Cámara libre + guardar posición van en un menú desplegable (diseñado por mí siguiendo el estilo, **valídalo**). Minimizar no hace falta: Miku vive en una esquina. |
| Voz silenciada | Solo el icono (altavoz tachado, fondo rosa 16 %), sin el texto "VOZ SILENCIADA" | Con el texto la barra no entraba en 750 px. |
| Panel de controles | adjuntar · **ocultar texto** · campo · botón principal | "Ocultar texto" (para capturas limpias) se movió acá, junto a donde se escribe. |
| Botón principal | 5 estados: micrófono (turquesa) · escuchando (rosa) · **enviar** (flecha, si hay algo escrito) · **cancelar** (✕, mientras piensa) · detener (cuadrado, mientras habla) | "Enviar" y "Cancelar" no estaban en la maqueta. |
| Subtítulo | Tras responder, **su última respuesta queda visible** hasta la próxima | Con la voz silenciada no hay estado "hablando": si se ocultaba en reposo, desaparecía antes de poder leerla. |
| Configuración | Cuentas de Gmail/Calendar en un **submenú desplegable** dentro de su fila; Modo stream y No molestar como **estado**, sin interruptor | Son automáticos (según OBS y el horario). Spotify no tiene "Desconectar" en el código, dice "Reconectar". |
| Presencia | Durmiendo / bailando / en vivo / no molestar reemplazan "EN ESPERA" **y la píldora de ánimo** solo en reposo | Si escucha o piensa, manda ese estado. |

## 3. Pendientes de escritorio (ventana 750 × 720)

### 3.1 Pantallas que no tienen diseño
1. **Panel de Quirks**: lista de gestos propios que Miku inventa, con estado (evaluando / confirmado), botones Confirmar · Volver a evaluar · Borrar. Hoy es una lista cruda con el estilo viejo.
2. **Panel de Apps y carpetas**: interruptor global "acciones desactivadas", carpetas con nombre editable a las que se **arrastran** apps, lista de apps descubiertas con buscador, ocultar/mostrar app, URL propia por app, agregar app personalizada. Es el panel más denso: necesita jerarquía.
3. **Pantalla de carga**: la primera vez se descarga el servidor de voz (barra de progreso + %), después rotan frases mientras arranca, y al final "Cargando a Miku…". Hoy es una píldora chica en el centro.
4. **Aviso al arrastrar un archivo** sobre la ventana ("Suéltalo para que Miku lo vea").
5. **Modo edición de Memoria**: al tocar "Corregir", la fila pasa a un textarea con Guardar / Cancelar. "Olvidar" y "Que la rediseñe" piden confirmación con un diálogo nativo de Windows; ¿conviene uno propio?
6. **Menú desplegable de la barra** (Cámara): validar o rediseñar.

### 3.2 Estados que faltan en todas las piezas
- **Hover, foco (teclado) y presionado** de cada botón; la ronda 1 solo mostraba reposo.
- **Deshabilitado**: mientras arranca el servidor de voz (mic, adjuntar y campo apagados).
- **Errores**: el modelo no respondió; reintento por saturación del proveedor (hoy es una nota gris en el subtítulo de "pensando"); falló conectar una cuenta; falló cambiar la salida de audio.
- **Vacíos y extremos**: sin cuentas conectadas; muchas tools en un mismo ciclo; respuesta muy larga (hoy el subtítulo tiene alto máximo 300 px y se desplaza); correos largos en el submenú de cuentas; conocimiento sin entradas o búsqueda sin resultados.
- **Combinaciones**: voz silenciada + durmiendo; bailando + escuchando; en vivo + pensando.

### 3.3 Movimiento
- Cómo aparecen/desaparecen la barra, el panel de escribir (hoy: fundido de 0.18 s subiendo 6 px) y el subtítulo.
- Transición entre estados del subtítulo (escuchando → pensando → hablando).
- Apertura de paneles, menús y submenús.
- Versión con "reducir movimiento" (hoy solo se apagan las barritas de baile y los LED).

### 3.4 Legibilidad sobre cualquier fondo
Proponer cómo se mantiene legible el vidrio oscuro (y los bordes turquesa) sobre un escritorio claro, sin volverlo opaco. Opacidades actuales: barra y panel 0.92, subtítulo 0.88, paneles grandes 0.96.

## 4. Android — rediseño completo + ícono nuevo

**No es una copia del escritorio**: misma estética (colores, tipografías, tono idol / Vocaloid), pero pensado para celular y para cómo se usa ahí (sobre todo con "Hey Miku" y el overlay). App en Kotlin + Jetpack Compose (Material 3). Hoy usa emojis en la UI (⚙️ 🔋 🖼️ ↺): reemplazarlos por iconos.

Superficies a diseñar:

| Superficie | Qué tiene hoy |
|---|---|
| **Ícono de la app** | Nuevo. Adaptive icon de Android (capa frontal + fondo por separado) **y versión monocroma** para los íconos temáticos de Android 13+. |
| **Ícono de notificación** | Monocromo, silueta simple (se ve blanco en la barra de estado). |
| **Configuración inicial** (`SetupScreen`) | Campos para las claves (credenciales) y botón para guardar. Solo se ve la primera vez. |
| **Chat** (`ChatScreen`) | Encabezado "Hatsune Miku"; burbujas de mensajes (él / Miku); indicador de "escribiendo"; campo "Escríbele a Miku…" con foto adjunta ("Foto lista para enviar"); historial de voz; detener audio. |
| **Configuración** (hoy una hoja dentro del chat) | Versión de la app; recargar memoria desde GitHub; interruptor de "Hey Miku"; evitar que el sistema corte el micrófono (batería); permiso para mostrarse sobre otras apps; **voz real de Miku**: descargar (~518 MB) con progreso, actualizar, reintentar si falla; conectar Spotify / Gmail / Calendar; borrar claves y cerrar sesión. |
| **Overlay flotante** (`MikuOverlayUi`) | Aparece sobre cualquier app al decir "Hey Miku": ícono de Miku que pulsa, "Escuchando…" / "Pensando…", la respuesta, cerrar. Es la cara principal de la app en el día a día. |
| **Widget** "Hablar con Miku" | Un botón en la pantalla de inicio (necesita "Hey Miku" prendido). |
| **Acceso rápido** (Quick Settings tile) | Prender / apagar "Hey Miku". |
| **Notificaciones** | Servicio de "Hey Miku" siempre activo, recordatorios, correo nuevo, eventos por empezar, resumen agrupado. |

Referencias de tamaño: diseña para un teléfono de ~390 × 844 pt, con modo oscuro como base (confirmar si hace falta modo claro).

## 5. Qué conviene adjuntar a este brief

Capturas reales (Sebastián):
1. La ventana de escritorio en reposo, con la barra visible (mouse encima) y sin ella, **sobre su escritorio real**; idealmente una sobre un fondo claro.
2. La ventana escuchando, pensando con tools y hablando.
3. Configuración y Memoria abiertas.
4. Los paneles viejos de Quirks y Apps y carpetas.
5. Del celular: chat, hoja de configuración, overlay en uso, widget y el ícono actual.

## 6. Datos para no inventar contenido

- **Ánimos** (píldora de la barra): CONTENTA · ENOJADA · TRISTE · TRANQUILA · NEUTRAL.
- **Categorías de tools** del rastro de "pensando": SPOTIFY, CORREO, CALENDARIO, WEB, APPS, ARCHIVOS, SONIDO, PENDIENTES, RECORDATORIO, PANTALLA, CÁMARA, HORA, y las de MCP con el nombre del servidor (ej. PLAYWRIGHT). Lista completa con textos en `Miku-AI/src/lib/toolLabels.ts`.
- **Bailes**: SIN GOLPE · TRANQUILO · MOVIDO.
- **Zonas de tacto** (Memoria › Tacto): cabeza, mejilla, coletas, mano, brazo, torso, falda, pierna, caricia en la cabeza, muchos toques seguidos, agitar la ventana.
- **Automático, sin interruptor**: modo stream (según OBS), no molestar (0:00–7:00), modo juego (la ventana se esconde sola con algo a pantalla completa; "Hey Miku" la trae).
