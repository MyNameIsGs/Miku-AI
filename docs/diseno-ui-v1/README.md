# Miku-AI — Interfaz nueva v1 (estilo idol / Vocaloid)

Especificación para implementar el rediseño de la interfaz de desktop (`Miku-AI/`). Los archivos `.dc.html` de esta carpeta son las maquetas originales del canvas de diseño: **son referencia visual, no código para copiar** (usan una sintaxis de plantillas propia: `{{…}}`, `<sc-for>`, `<x-dc>`). Ábrelos en el navegador si hace falta ver algo; los valores exactos están abajo.

| Archivo | Pantalla |
|---|---|
| `Main.dc.html` | 1 · En espera |
| `Escuchando.dc.html` | 2 · Escuchando |
| `Pensando.dc.html` | 3 · Pensando (con tools) |
| `Hablando.dc.html` | 4 · Hablando |
| `Config.dc.html` | Panel de Configuración |
| `Memoria.dc.html` | Panel de Memoria |
| `Presencia.dc.html` | Variantes de la barra superior |

---

## 1. Qué NO cambia (reglas del rediseño)

- **Es un cambio visual.** No se toca lógica de voz, LLM, tools, memoria ni movimiento. Mismos hooks, mismo estado.
- Ventana **750 × 720**, transparente, siempre encima. Barra de **40 px** arriba; la ventana se arrastra **solo desde la barra**; clic sobre Miku = tocarla. El **click-through por zonas** tiene que seguir funcionando: las zonas nuevas con UI son la barra, el panel de controles de abajo y la caja de texto (subtítulo).
- **Sin insignia de "hablando"** (Sebastián la pidió quitar por redundante). En el estado hablando, la barra no muestra estado.
- Iconos: SVG en línea con trazo (`stroke="currentColor"`), **nunca emoji** en la UI (reemplaza 🔊/🔇/⏹/📎 actuales).
- Texto en español neutro con tuteo, sin voseo.

## 2. Tokens de diseño

Sugerencia: definirlos como variables CSS en `App.css` (`:root`).

| Token | Valor | Uso |
|---|---|---|
| `--m-teal` | `#39C5BB` | Acento de Miku: estado, botón de mic, activo |
| `--m-teal-dim` | `#2A8F88` | Teclas negras encendidas (turquesa) |
| `--m-pink` | `#F0508F` | Acento secundario: "tú", escuchando, su voz al hablar |
| `--m-pink-text` | `#F58AB3` | Texto rosa sobre fondo oscuro |
| `--m-pink-dim` | `#B83A6C` | Teclas negras encendidas (rosa) |
| `--m-text` | `#EAF4F3` | Texto principal |
| `--m-muted` | `#9DB9B6` | Texto secundario, iconos |
| `--m-dim` | `#7E9B98` | Placeholders, notas |
| `--m-glass` | `rgba(9,20,23,0.92)` | Fondo de barra y panel de controles |
| `--m-glass-caption` | `rgba(9,20,23,0.88)` | Caja de subtítulo |
| `--m-glass-panel` | `rgba(9,20,23,0.96)` | Paneles Config / Memoria |
| `--m-line` | `rgba(57,197,187,0.3)` | Bordes turquesa |
| `--m-line-soft` | `rgba(157,185,182,0.25)` | Bordes de botones secundarios |
| `--m-fill-soft` | `rgba(234,244,243,0.05)` | Fondo de inputs |
| `--m-module` | `rgba(234,244,243,0.035)` | Fondo de módulos en paneles |
| Texto sobre turquesa | `#06221F` | |
| Texto sobre rosa | `#2A0714` | |

**Tipografías** (Google Fonts, o empaquetarlas localmente en `public/fonts/` porque la app puede arrancar sin red):

```
https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600&family=Dela+Gothic+One&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap
```

| Rol | Familia | Uso |
|---|---|---|
| Display | `'Dela Gothic One', 'Arial Black', sans-serif` | Wordmark "MIKU" (15 px, `letter-spacing: .08em`), títulos de panel (24 px) |
| Etiquetas | `'Chakra Petch', 'Bahnschrift', monospace` | Lecturas tipo consola, MAYÚSCULAS, 10–11 px, peso 600, `letter-spacing: .1–.14em` |
| Cuerpo | `'Zen Kaku Gothic New', 'Yu Gothic', 'Segoe UI', sans-serif` | Todo lo demás |

**Radios:** panel de controles 22 px · subtítulo 18 px · módulos 16 px · inputs/botones 14 px (controles), 10–12 px (paneles) · píldoras 999 px.

## 3. Ventana principal

### Barra superior (40 px, `--m-glass`, borde inferior `--m-line`)
- **Izquierda:** wordmark `MIKU` (turquesa) + `CH·01` (rosa, Chakra 10 px) · separador 1×18 px · **estado** (LED 7 px + texto) · **píldora de ánimo** (borde rosa 45 %, `ÁNIMO` rosa + valor en `--m-text`) con el `currentMood` real.
- **Derecha:** botones de 40×40 (fondo transparente, radio 10, icono 18 px `--m-muted`): Apps y carpetas · Memoria · Configuración · Silenciar voz · separador · Minimizar · Cerrar. Botón activo (panel abierto): fondo `rgba(57,197,187,0.16)`, icono turquesa. Todos con `aria-label`.
- Estado en la barra según `avatarState`:

| avatarState | LED | Texto |
|---|---|---|
| `idle` | turquesa fijo | EN ESPERA |
| `listening` | rosa, parpadeo suave 1.2 s | ESCUCHANDO |
| `thinking` | turquesa, parpadeo 0.9 s | PENSANDO |
| `speaking` | — (sin estado) | — |

Estados de presencia (ver `Presencia.dc.html`), en orden de prioridad sugerido: modo juego (la ventana ya se oculta) > en vivo > durmiendo > bailando > no molestar > normal. Voz silenciada no reemplaza el estado: marca el botón de voz (fondo rosa 16 %, icono de altavoz tachado, texto `VOZ SILENCIADA`).

| Estado | Aspecto |
|---|---|
| Durmiendo | Barra más apagada (fondo 0.7, borde gris), wordmark `#5E8B87`, icono luna + `DURMIENDO` |
| Bailando | Borde rosa 40 %, icono nota + `BAILANDO · MOVIDO/TRANQUILO/SIN GOLPE` + 5 barritas rosa |
| En vivo (OBS) | Píldora rosa sólida con icono de emisión + `EN VIVO` |
| No molestar | Icono círculo con guion + `NO MOLESTAR · HASTA 7:00` |

### Avatar y escenario
El canvas de three.js ocupa el fondo como hoy. Nuevo: dos **elipses de "escenario"** a los pies de Miku (320×60 borde 1.5 px turquesa 45 %, y 220×34 borde 1 px turquesa 25 %, centradas, `top` ≈ 512 y 525 px). Al hablar, pasan a rosa (55 % / 30 %) con `box-shadow: 0 0 24px rgba(240,80,143,.25)`. Deben ser `pointer-events: none`. Si interfieren con el cuerpo en el VRM, se pueden dibujar en la escena three.js en vez de CSS.

### Panel de controles (abajo)
- Posición: `left 20, top 596, 710 × 104`, `--m-glass`, borde `--m-line`, radio 22, padding `12 14 14`, columna con gap 10.
- **Tira de teclas de piano** (elemento distintivo, reemplaza al medidor de nivel): 36 teclas en fila, `flex: 1`, gap 3, alineadas abajo. Patrón por octava `B N B N B B N B N B N B`: blancas 11 px de alto, negras 7 px, radio 2.
  - Apagadas: blancas `rgba(234,244,243,0.12)`, negras `rgba(157,185,182,0.22)`.
  - **Escuchando:** se encienden en turquesa según el nivel del micrófono (VAD / nivel de entrada).
  - **Hablando:** se encienden en rosa según el nivel del audio de Miku (puede salir del mismo análisis que alimenta los visemas).
  - **Pensando:** barrido de una tecla turquesa con dos vecinas al 45 % que recorre la fila.
  - `aria-hidden="true"` (es decorativo).
- **Fila:** botón adjuntar 44×44 (clip) · input de texto (flex, alto 44, radio 14, placeholder `Escribe, pega una imagen o di «Hey Miku»`, con `<label>` oculto) · botón principal redondo 52×52.
- Botón principal según estado:
  - idle / pensando: **mic**, fondo turquesa, icono `#06221F`, anillo `0 0 0 4px rgba(57,197,187,.15)`.
  - escuchando: fondo rosa, `aria-pressed="true"`, anillos `0 0 0 5px rgba(240,80,143,.22), 0 0 0 11px rgba(240,80,143,.08)`; el input se deshabilita con placeholder `Escuchando…`.
  - hablando: **detener** (cuadrado relleno), fondo `--m-text`, icono `#12161a`. Es el ⏹ actual.

### Caja de subtítulo (encima del panel de controles)
`left 40, width 670`, fondo `--m-glass-caption`, radio 18, padding `14 20 16`. Se ancla abajo, justo encima del panel de controles (crece hacia arriba). Oculta en idle. `aria-live="polite"`.

- **Escuchando:** borde rosa 35 %. Etiqueta `TÚ` (rosa) + `· SE CORTA SOLO CUANDO TERMINAS DE HABLAR` (`--m-dim`). Transcripción a 21 px peso 500: palabras confirmadas en `--m-text`; el tramo final sin confirmar en `--m-dim` peso 400 (misma lógica LocalAgreement actual, solo cambia el estilo).
- **Pensando:** borde turquesa. Arriba, eco del mensaje del usuario (14 px `--m-muted`, prefijo `TÚ ·` rosa). Separador. Debajo, **rastro de tools** del ciclo de tool calling actual: una fila por tool con icono de estado (✓ turquesa en círculo 22 px si terminó, anillo girando si está en curso) · categoría en Chakra 11 px (`SPOTIFY`, `CORREO`, `CALENDARIO`, `WEB`, `APPS`…) · texto humano ("Buscó en tus playlists", "Reproduciendo playlist…"). Hace falta un mapa `nombre_de_tool → {categoría, texto en curso, texto terminado}`; si una tool no está en el mapa, mostrar su nombre legible.
- **Hablando:** borde turquesa. Etiqueta `MIKU` (turquesa). Texto a 24 px peso 700, revelado por palabras con el mismo loop que hoy; **la última palabra revelada** va en turquesa con subrayado rosa de 3 px, estilo letra de karaoke.

## 4. Paneles

Ambos: `left 12, top 52, 726 × 656`, `--m-glass-panel`, borde `--m-line`, radio 22, padding `18 20 20`. Encabezado: título Dela Gothic 24 px + etiqueta Chakra rosa (`MIXER` / `ARCHIVO`) + botón cerrar 40×40. La barra superior queda visible con el botón del panel marcado como activo. Si el contenido no entra, scroll interno.

### Configuración (`ConfigPanel.tsx`)
Grilla de 2 columnas (gap 14) de **módulos** numerados (`01 VOZ` etc., número rosa + nombre turquesa, Chakra 11 px):
- **01 VOZ:** Tono y Velocidad (`<input type="range">` con `accent-color: #39C5BB`, extremos "grave — aguda", "lenta — rápida"); Boca (segmentado `Desde el texto` / `Rhubarb` → `lipsyncMode`); Salida de audio (`<select>`).
- **02 CONEXIONES:** Spotify, Gmail (n cuentas + botón `Otra cuenta`), Google Calendar, Playwright · MCP (`se reconecta solo`). Cada fila: nombre, LED + estado, botón a la derecha.
- **03 ACCIONES:** interruptores: Acciones en el PC (el interruptor global actual), Modo stream automático (con estado de OBS), No molestar (0:00–7:00).
- **04 HOY:** Costo y Tokens del día (Chakra 24 px) + enlace "Ver por tipo de llamada".
- Pie: botones `Quirks` y `Apps y carpetas` (abren los paneles existentes, que por ahora mantienen su diseño).
- Interruptores: botón 44×26, `aria-pressed`, encendido fondo turquesa + perilla `#06221F` a la derecha; apagado fondo `rgba(157,185,182,.25)` + perilla `--m-muted` a la izquierda.

Cualquier opción que hoy exista en ConfigPanel y no aparezca en la maqueta se conserva, ubicada en el módulo que corresponda.

### Memoria (`MemoryPanel.tsx`)
- Pestañas en píldora (`role="tab"`): Conocimiento · Recuerdos · Personalidad · Diario · Tacto. Activa: fondo turquesa, texto `#06221F` peso 700.
- Texto guía: "Saber práctico que puedes corregir u olvidar. Sus recuerdos, su personalidad y su diario son suyos: se leen, no se editan."
- Búsqueda "Buscar por significado" (usa `rankByMeaning` de `knowledge.ts` si es barato; si no, filtro de texto).
- Filas de conocimiento: número rosa (Chakra) · texto · `Corregir` (borde turquesa) · `Olvidar` (borde gris). Sin borde izquierdo de color.
- Pie en Chakra: `CONOCIMIENTO.MD · N ENTRADAS` · `EN CADA CHARLA USA LAS 6 MÁS CERCANAS`.
- Recuerdos / Personalidad / Diario: mismo marco, solo lectura. Tacto: lista de zonas con su botón "que la rediseñe" actual.

## 5. Orden sugerido (una tarea a la vez)

1. Tokens + tipografías + iconos SVG (sin cambiar la estructura).
2. Barra superior (estado, ánimo, iconos, activo).
3. Panel de controles + tira de teclas (primero apagada, después conectada al nivel de audio).
4. Caja de subtítulo en sus tres estados (incluido el rastro de tools).
5. Elipses de escenario.
6. Panel de Configuración.
7. Panel de Memoria.
8. Estados de presencia en la barra.

Cada paso se confirma en vivo antes de seguir, y se verifica que el click-through y el arrastre desde la barra siguen funcionando.
