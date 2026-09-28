# Miku-AI — Diseño ronda 2 (respuesta al brief)

Responde a `docs/diseno-ui-v2/README.md`. Mismo formato que la ronda 1: maquetas `.dc.html` en `maquetas/` (**referencia visual, no código para copiar**: usan plantillas propias `{{…}}`, `<sc-for>`, `<x-dc>`) y los valores exactos en este documento. El ícono de Android ya está listo en `android-icono/`.

Los tokens `--m-*` de `App.css` y las tres tipografías siguen igual. Esta ronda solo **agrega** tokens (§1).

Lo marcado como **PROPUESTA** es algo que no existe hoy en el código: se implementa solo si Sebastián lo aprueba.

---

## 0. Maquetas

| Archivo | Qué muestra |
|---|---|
| `Quirks.dc.html` | Panel de Quirks agrupado por estado |
| `Apps.dc.html` | Apps y carpetas: una carpeta recibiendo una app arrastrada, filas con enlace y oculta |
| `Carga.dc.html` | Carga: 1) primera descarga, 2) arranque con frases y controles deshabilitados |
| `Soltar.dc.html` | Aviso al arrastrar un archivo |
| `MemoriaEdicion.dc.html` | 1) Corregir en la fila, 2) diálogo «Olvidar», 3) pestaña Tacto + diálogo «Que la rediseñe» |
| `MenuCamara.dc.html` | Menú de cámara: foco de teclado; cámara libre + posición guardada |
| `Combinaciones.dc.html` | Estados combinados en la barra |
| `EstadosControles.dc.html` | Reposo / hover / foco / presionado / deshabilitado de cada control + las 5 caras del botón principal |
| `Errores.dc.html` | Modelo sin respuesta, saturación, cuenta que falló, salida de audio que falló |
| `Extremos.dc.html` | Sin cuentas, muchas tools, respuesta larga, correos largos, vacíos, búsqueda sin resultados |
| `Movimiento.dc.html` | Tabla de animaciones con duraciones, curvas y «reducir movimiento» |
| `Legibilidad.dc.html` | Hoy vs propuesta sobre un fondo claro |
| `AndSetup` · `AndChat` · `AndChatFoto` · `AndConfig` · `AndOverlay` · `AndWidget` · `AndNotif` | Android |

---

## 1. Tokens nuevos (escritorio)

Agregar a `:root` en `App.css`:

| Token | Valor | Uso |
|---|---|---|
| `--m-teal-hover` | `#5AD3CA` | Relleno turquesa en hover |
| `--m-teal-press` | `#2FA99F` | Relleno turquesa presionado |
| `--m-focus` | `#7FE3DA` | Anillo de foco: `outline: 2px solid var(--m-focus); outline-offset: 2px` (4 px en el botón principal; −2 px en ítems de menú) |
| `--m-hover-fill` | `rgba(234,244,243,0.08)` | Fondo en hover de botones de icono |
| `--m-press-fill` | `rgba(57,197,187,0.24)` | Fondo presionado de botones de icono |
| `--m-disabled-fill` | `rgba(157,185,182,0.14)` | Fondo del botón principal deshabilitado (icono `#4E6866`) |
| `--m-scrim` | `rgba(5,10,12,0.62)` | Velo bajo los diálogos |
| `--m-dialog` | `#0B1719` | Fondo del diálogo (opaco) |
| `--m-edge` | `0 0 0 1px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.06)` | Contorno de legibilidad (§5) |
| `--m-ease-out` | `cubic-bezier(.2,.8,.2,1)` | Entradas |
| `--m-ease-in` | `cubic-bezier(.4,0,1,1)` | Salidas |
| `--m-ease-std` | `cubic-bezier(.4,0,.2,1)` | Cambios dentro de algo que ya se ve |

Iconos nuevos para `Icons.tsx` (SVG 24×24, trazo 1.8, `round`; los paths están en las maquetas): candado, cámara, ojo / ojo tachado, papelera, enlace, agarre (6 puntos, relleno), carpeta, más, flecha atrás, recargar, alerta (círculo con `!`), descargar, guardar (disquete), reloj (historial), salir, imagen.

---

## 2. Pantallas nuevas de escritorio

### 2.1 Quirks (`QuirksPanel.tsx`)
Mismo marco que los paneles de la ronda 1 (`left 12, top 52, 726 × 656`, radio 22, `--m-glass-panel`). Se abre desde Configuración, así que lleva un **botón atrás** (36 × 36, radio 12) a la izquierda del título y el botón de Configuración queda activo en la barra.

- Título «Quirks» (Dela 24) + etiqueta rosa `GESTOS PROPIOS`. Texto guía 13 px `--m-muted`, máx. 560 px.
- **Dos grupos**, en este orden: `EVALUANDO · n` (LED de contorno rosa) y `CONFIRMADOS · n` (LED turquesa). Dentro, orden alfabético como hoy.
- Fila: padding `12 14`, radio 12, gap 14.
  - Evaluando: fondo `rgba(240,80,143,0.05)`, borde `rgba(240,80,143,0.28)`. Acciones: **Confirmar** (primario turquesa con ✓) + papelera (32 × 32).
  - Confirmado: fondo `--m-module`, borde `rgba(157,185,182,0.14)`. Acciones: **Volver a evaluar** (secundario con icono recargar) + papelera.
- Nombre 15 px peso 500. Descripción 12 px `--m-muted`, **humanizada** (hoy `describeQuirk` muestra nombres de hueso crudos y `izq=`):
  - Huesos traducidos y separados con « · »: `head` → cabeza, `neck` → cuello, `spine`/`chest` → columna, `hips` → cadera, `rightUpperArm` → brazo derecho, etc.
  - Animado: `animado, 1,2 s por ciclo × 3` (coma decimal). Fijo: `2,0 s`.
  - Manos: `mano izq: a la mejilla`, `mano der: abierta`, `manos: abiertas` si coinciden.
- **Borrar pide confirmación** con el diálogo propio de §2.5 («¿Borrar este gesto? Miku ya no lo va a usar. No se puede deshacer.», botón rosa «Borrar»).
- Vacío: ver §3.2.
- Los nombres de la maqueta son de ejemplo; los reales los elige ella.

### 2.2 Apps y carpetas (`AppLauncherPanel.tsx`)
El panel más denso: jerarquía en tres niveles.

1. **Interruptor global arriba**, en un bloque destacado (padding `12 16`, radio 14, fondo `rgba(57,197,187,0.07)`, borde `--m-line`): «Acciones en el PC» + «Apágalo y Miku no podrá abrir ni tocar nada del escritorio.» Es el mismo `actionsDisabled` de hoy, con la lógica invertida en la etiqueta (encendido = acciones permitidas).
2. **Dos columnas** (`grid-template-columns: 290px 1fr`, gap 16):
   - **Carpetas** (izquierda):
     - Encabezado `CARPETAS · n` + «arrastra apps aquí».
     - Tarjeta por carpeta: padding 12, radio 14, fondo `--m-module`, borde `rgba(157,185,182,0.18)`.
     - Nombre editable como `<input>` sin borde (14 px peso 700) que muestra borde `--m-line-soft` en hover y `--m-teal` en foco; se guarda al salir del campo, como hoy.
     - Chips de apps: alto 26, radio 999, fondo `rgba(57,197,187,0.12)`, borde `rgba(57,197,187,0.3)`, con ✕ de 20 × 20.
     - Al final, fila «Carpeta nueva…» + botón «Crear».
     - **Mientras se arrastra encima:** borde `1.5px dashed #39C5BB`, fondo `rgba(57,197,187,0.09)`, etiqueta `SUELTA PARA AGREGAR` y un chip fantasma con borde punteado.
   - **Apps** (derecha):
     - Segmentado `Descubiertas · n` / `Tuyas · n` (lo que hoy son «personalizadas»), botón «Script o .exe» (abre el mismo formulario de hoy) y buscador.
     - Fila de 40 px: agarre · nombre · enlace · ojo.
     - **La URL ya no ocupa un campo por fila.** Un botón de enlace la despliega debajo (input con borde turquesa y placeholder «https://… (opcional: se abre con esta app)»). Si ya tiene URL, se muestra el dominio en turquesa 12 px antes del botón.
     - **Oculta:** nombre tachado `--m-dim`, etiqueta `OCULTA` rosa y ojo tachado con fondo rosa 14 %. El checkbox de hoy pasa a ser este botón de ojo (`aria-pressed`).
     - Al arrastrar: la fila queda al 40 % con borde punteado y el cursor lleva una copia (fondo `#16292C`, borde turquesa, sombra, rotada −2°).
3. La pestaña «Tuyas» lista las apps personalizadas con papelera y, abajo, el formulario actual (nombre, «Elegir archivo…», «Agregar»).

### 2.3 Pantalla de carga
Dos fases, sobre la ventana transparente (sin fondo opaco):

**1 · Primera vez (descarga):**
- Tarjeta centrada de 400 px: padding `28 28 24`, radio 22, fondo `rgba(9,20,23,0.94)`, `--m-edge`.
- Contenido: ícono del cebollín 56 px · «Preparando su voz» (Dela 19) · «Es la primera vez: falta descargar el servidor de voz. Solo pasa una vez.»
- **Progreso = la tira de teclas**: 36 teclas, blancas 14 px y negras 9 px de alto; encendidas en turquesa según el %. Debajo, `DESCARGANDO` + el % en Chakra 20 px.
- Tres pasos en píldoras: `1 DESCARGAR · 2 VERIFICAR · 3 ARRANCAR`. El actual va relleno turquesa; los pendientes, con contorno. «Verificar» es el SHA256 que ya existe.

**2 · Cada arranque:**
- El avatar se va cargando detrás.
- Píldora de estado centrada a `top 520`: alto 40, spinner 14 px + la frase de `useLoadingPhrase` (cambia cada 3 s con el fundido actual). La última es «Cargando a Miku…».
- El **panel de controles se muestra deshabilitado**: adjuntar, campo (placeholder «Iniciando sistema de voz…», borde punteado) y micrófono apagados; la tira de teclas al 50 %. «Ocultar texto» sigue activo.

### 2.4 Soltar un archivo
- Mientras se arrastra un archivo sobre la ventana (`dragenter` HTML5, como hoy):
  - Capa a 12 px de cada borde, radio 26, fondo `rgba(9,20,23,0.62)`, borde `2px dashed #39C5BB`.
  - Al centro: icono de archivo con flecha (72 × 72, fondo turquesa, radio 22, halo `0 0 0 8px rgba(57,197,187,0.16)`) · «Suéltalo para que Miku lo vea» (Dela 20) · `IMÁGENES Y ARCHIVOS DE TEXTO`.
- Los textos llevan un fondo `rgba(9,20,23,0.9)` propio para leerse sobre el avatar.
- Si el archivo no es de un tipo aceptado, el borde pasa a rosa y el texto a «Miku no puede abrir este tipo de archivo» (**PROPUESTA**, si el tipo se puede saber en `dragover`).

### 2.5 Memoria: corregir y confirmar
- **Corregir** convierte la fila en un editor en su lugar:
  - La fila: fondo `rgba(57,197,187,0.06)`, borde turquesa y halo de 3 px; etiqueta `CORREGIENDO`.
  - El texto: textarea de 3 filas.
  - Acciones: «Cancelar» (secundario) y «Guardar» (primario).
  - Atajos: Enter guarda, Esc cancela, Shift+Enter hace salto de línea.
  - Las otras filas bajan al 45 % mientras se edita.
- **Sí conviene un diálogo propio** en vez del nativo de Windows: el nativo rompe la estética, no hereda el «siempre encima» de forma fiable y aparece fuera de la ventana chica.
  - Velo `--m-scrim` sobre la ventana.
  - Tarjeta de 440 px: padding `22 22 18`, radio 20, fondo `--m-dialog`, borde `rgba(57,197,187,0.35)`, sombra `0 20px 48px rgba(0,0,0,0.55)`.
  - `role="dialog"`, `aria-modal`, foco inicial en **Cancelar**, Esc cierra, el foco no sale del diálogo.
- Textos:
  - **Olvidar:** «¿Olvidar esto?» + la entrada citada en una caja + «Miku deja de usarlo en sus charlas. No se puede deshacer.» Botón **rosa** «Olvidar» (texto `--m-on-pink`).
  - **Que la rediseñe:** «¿Que rediseñe «mejilla»?» + «Miku va a diseñar una reacción nueva para esta zona. La actual se reemplaza cuando termine.» Botón **turquesa** (no es destructivo).
  - **Borrar quirk:** ver §2.1.
- **Pestaña Tacto** (no tenía diseño):
  - Grilla de 2 columnas con las 11 zonas del brief.
  - Cada fila: nombre + estado (`DISEÑADA POR ELLA` en turquesa, o `RESPALDO · AÚN NO LA DISEÑA` en `--m-dim`) + «Que la rediseñe».

### 2.6 Menú de cámara (validado, con ajustes)
El menú actual funciona. Ajustes:

- Caja: ancho 272, padding 6, radio 14, fondo `rgba(9,20,23,0.97)`, borde `rgba(57,197,187,0.35)`, sombra `0 14px 32px rgba(0,0,0,0.45)`. Alineada al borde izquierdo del botón, 4 px debajo de la barra.
- Ítems de **44 px** de alto mínimo (hoy son más bajos), en grilla `22px 1fr`: marca, texto 14 px y pista 12 px `--m-dim` debajo del texto (hoy va al lado y se corta).
- «Cámara libre» usa una **casilla** (18 × 18, radio 5, rellena turquesa con ✓ cuando está activa) en vez de un ✓ suelto.
- «Guardar posición de la cámara» → «**Guardar posición**» con icono de disquete y la pista «así arranca la próxima vez». Tras guardar, durante 1,5 s: «Posición guardada» en turquesa con ✓ (como hoy).
- Teclado: flechas arriba/abajo recorren los ítems, Enter o Espacio activan, Esc cierra y devuelve el foco al botón.
- **PROPUESTA:** mientras la cámara libre está activa, una píldora abajo al centro (`CÁMARA LIBRE` + botón «Listo») y el contorno del avatar en turquesa. Recuerda que arrastrar sobre Miku mueve la vista en vez de tocarla.

---

## 3. Estados (todas las piezas)

Ver `EstadosControles.dc.html`. Resumen:

| Control | Hover | Foco | Presionado | Deshabilitado |
|---|---|---|---|---|
| Botón de barra 40 × 40 | fondo `--m-hover-fill`, icono `--m-text` | anillo `--m-focus` | fondo `--m-press-fill`, icono turquesa, `scale(.94)` | opacidad 0.35 |
| Botón principal 52 | `--m-teal-hover` + halo 6 px `rgba(57,197,187,.22)` | anillo, separación 4 px | `--m-teal-press`, sin halo, `scale(.94)` | `--m-disabled-fill`, icono `#4E6866`, sin halo |
| Secundario | borde `rgba(57,197,187,.45)`, texto `--m-text` | anillo | fondo `rgba(57,197,187,.14)`, texto turquesa | opacidad 0.35 |
| Primario (Guardar…) | `--m-teal-hover` | anillo | `--m-teal-press`, `scale(.97)` | fondo `rgba(157,185,182,.18)`, texto `#4E6866` |
| Interruptor | pista `--m-teal-hover` | anillo | perilla se estira a 24 px | opacidad 0.35 |
| Campo | borde `rgba(157,185,182,.4)` | borde turquesa + halo 3 px `rgba(57,197,187,.2)` | — | borde punteado 18 %, fondo 2 % |
| Pestaña | borde turquesa 45 %, texto `--m-text` | anillo | fondo turquesa 14 % | opacidad 0.35 |
| Ítem de menú | fondo `rgba(234,244,243,.06)` | anillo interior (−2 px) | fondo turquesa 14 %, texto turquesa | texto `#5E7C79` |

- El foco se muestra **solo con teclado** (`:focus-visible`).
- Las 5 caras del botón principal no cambian respecto a lo implementado: micrófono · escuchando · enviar · cancelar · detener.
- **Deshabilitado global** (servidor de voz arrancando): ver §2.3, fase 2.

### 3.1 Errores (`Errores.dc.html`)
- **El modelo no respondió** (tras los 3 reintentos):
  - La caja de subtítulo pasa a error: borde `rgba(240,80,143,.55)`, etiqueta con icono de alerta y `NO PUDE RESPONDER` en `--m-pink-text`, texto 15 px.
  - **PROPUESTA:** botones «Reintentar» (primario, vuelve a mandar el último mensaje) y «Descartar». El mensaje queda en el campo para no perderlo.
- **Proveedor saturado (429):** reemplaza la nota gris actual.
  - Fila dentro del rastro de tools: fondo `rgba(240,80,143,.08)`, radio 10.
  - Icono recargar girando (1,6 s) + `SATURADO · REINTENTO 2 DE 3` + la cuenta regresiva «en 4 s» (Chakra 13 px, alineada a la derecha).
- **Falló conectar una cuenta:** en la fila de Conexiones, el LED y el texto pasan a rosa con el motivo en una línea, y el botón dice «Reintentar».
  - Caso real y frecuente: «Sesión vencida: Google la corta cada 7 días en modo prueba.» → «Reconectar».
- **Falló cambiar la salida de audio:** el `<select>` toma borde rosa (`aria-invalid`) y debajo aparece «No pude cambiar a «X». Sigue sonando por la salida anterior.» (12 px rosa, con icono).

### 3.2 Vacíos y extremos (`Extremos.dc.html`)
- **Sin cuentas:** LED de contorno `--m-dim`, «Sin conectar» (Playwright: «Apagado»), botón «Conectar» con contorno turquesa.
- **Muchas tools:** se ven las **3 últimas**. Las anteriores se juntan en un botón «n pasos más, ya hechos» (alto 26, con flecha) que al tocarlo las despliega.
- **Respuesta muy larga:** se mantiene el alto máximo de 300 px con desplazamiento al final.
  - Arriba, degradado de máscara de 56 px (`mask-image: linear-gradient(to bottom, transparent 0, #000 56px)`) para que se note que hay más.
  - Barra de desplazamiento propia de 3 px, turquesa 50 %, visible solo con el mouse encima.
- **Correos largos en el submenú:**
  - Una línea con `text-overflow: ellipsis` y el correo completo en `title`, más ✕ para quitar la cuenta.
  - Al final, separador + «Agregar otra cuenta» en turquesa.
  - El submenú usa la misma caja que el menú de cámara.
- **Conocimiento vacío:** icono de libro en caja turquesa 12 % · «Todavía no sabe nada práctico» · «Cuando le cuentes algo útil («mi GPU es…», «prefiero…»), lo anota sola y aparece aquí.»
- **Quirks vacío:** «Sin gestos propios todavía» · «Los inventa en sus momentos de silencio.»
- **Búsqueda sin resultados:** «Nada cercano a «…»» · «La búsqueda es por significado: prueba con otras palabras.» · «Borrar búsqueda».

### 3.3 Combinaciones (`Combinaciones.dc.html`)
| Combinación | Barra |
|---|---|
| Voz silenciada + durmiendo | Manda DURMIENDO (barra apagada); el botón de voz sigue en rosa |
| Bailando + escuchando | Manda ESCUCHANDO + ánimo. **PROPUESTA:** nota rosa de 14 px al final = «la música sigue» |
| En vivo + pensando / escuchando / hablando | **PROPUESTA:** «VIVO» compacto (píldora rosa, antes del estado) **nunca se esconde**, porque decide qué se puede decir en stream. Hoy desaparece si escucha o piensa |
| No molestar + escuchando | Manda ESCUCHANDO (no molestar solo afecta a los avisos) |
| Bloqueada | El candado queda turquesa (activo), para saber por qué no responde a clics |

---

## 4. Movimiento (`Movimiento.dc.html`)

| Qué | Cómo | Duración | Curva | Con «reducir movimiento» |
|---|---|---|---|---|
| Barra y panel aparecen (mouse entra) | fundido + suben 6 px | 180 ms | salida | solo fundido 120 ms |
| Barra y panel se van (mouse sale) | espera 600 ms, fundido + bajan 6 px | 600 + 180 ms | entrada | solo fundido 120 ms |
| Subtítulo aparece | fundido + sube 8 px, el alto crece | 220 ms | salida | solo fundido 120 ms |
| Subtítulo sube o baja con el panel | mismo `top` animado que el panel | 180 ms | la del panel | sin animar |
| Subtítulo cambia de estado | contenido cruzado 160 ms + alto 200 ms | 200 ms | estándar | cambio directo |
| Panel abre | fundido + escala 0,98 → 1 (`transform-origin: top`) | 220 ms | salida | solo fundido 120 ms |
| Panel cierra | fundido + escala 1 → 0,98 | 160 ms | entrada | solo fundido 100 ms |
| Menú y submenú | fundido + bajan 4 px desde su botón | 140 ms | salida | solo fundido 100 ms |
| Diálogo | velo 160 ms; tarjeta escala 0,96 → 1 empezando a los 40 ms | 200 ms | salida | solo fundido 120 ms |
| Botón principal cambia de cara | icono cruzado + giro de 90° | 160 ms | estándar | icono cruzado sin giro |
| LED y barritas de baile | pulso 1,2 s (escuchando) / 0,9 s (pensando) | continuo | — | quietos (ya es así) |
| Tira de teclas | sigue al audio; pensando, barrido de 22 teclas/s | continuo | — | **el nivel se mantiene** (es información); el barrido se reemplaza por 3 teclas fijas encendidas en el centro |

- La espera de 600 ms al salir el mouse evita que la UI parpadee cuando el cursor solo pasa por encima.
- Todo usa `transform` y `opacity`, nada que cambie el layout salvo el alto del subtítulo.

---

## 5. Legibilidad sobre cualquier fondo (`Legibilidad.dc.html`)

**Límite técnico:** en una ventana transparente de WebView2, `backdrop-filter` **no desenfoca el escritorio**, solo lo que hay dentro de la página. El efecto acrílico de Windows (crate `window-vibrancy`) se aplica a la ventana entera, así que taparía la transparencia alrededor de Miku. Por eso la propuesta no usa desenfoque.

**Propuesta** (solo en barra, panel de controles, subtítulo, menús y paneles):

1. Opacidad del vidrio a **0.94** en barra, panel de controles y subtítulo (hoy 0.92 / 0.88); los paneles grandes siguen en 0.96.
2. Borde turquesa de **30 % → 40 %**.
3. **`--m-edge`:** un contorno oscuro de 1 px por fuera (`0 0 0 1px rgba(0,0,0,.5)`), que es lo que separa la forma de un fondo blanco, más una sombra suave y un brillo interior de 1 px arriba. En la barra, que toca el borde de la ventana, solo `0 1px 0 rgba(0,0,0,.5), 0 6px 18px rgba(0,0,0,.22)`.
4. El texto de Miku en el subtítulo sube a **peso 500** (sigue en 16 px).

Sobre fondos oscuros el cambio casi no se nota; sobre blanco, las cajas dejan de verse «grises y sucias» y los bordes no se pierden.

---

## 6. Android

Misma estética, pensada para el teléfono. Modo oscuro como base; el modo claro queda fuera hasta que Sebastián lo pida.

### 6.1 Tema (Compose, `ui/theme/`)
| Rol M3 | Valor |
|---|---|
| `background` / `surface` | `#0B1517` |
| `surfaceContainer` (tarjetas) | `rgba(234,244,243,0.04)` sobre el fondo ≈ `#131E20`, borde `rgba(57,197,187,0.2)` |
| `primary` / `onPrimary` | `#39C5BB` / `#06221F` |
| `secondary` / `onSecondary` | `#F0508F` / `#2A0714` |
| `onSurface` / `onSurfaceVariant` | `#EAF4F3` / `#9DB9B6` |
| `outline` | `rgba(157,185,182,0.28)` |
| `error` | `#F58AB3` (texto) sobre `rgba(240,80,143,0.06)` |

- **Tipografías:** las mismas tres, empaquetadas en `res/font/`. Títulos en Dela Gothic One, etiquetas en Chakra Petch (11 sp, peso 600, `letterSpacing 0.12em`, MAYÚSCULAS) y el resto en Zen Kaku Gothic New.
- **Tamaños:** cuerpo 15 sp, burbujas 15 sp, títulos de pantalla 22 sp, «Miku» en la cabecera 19 sp.
- **Radios:** tarjetas 18, campos 14, píldoras 22, burbujas 18 (con la esquina de la cola en 6).
- Toques de 44 dp como mínimo.
- **Sin emojis:** ⚙️ 🔋 🖼️ ↺ se reemplazan por iconos de trazo (ajustes, batería o permiso, imagen, recargar).
- **Avatar de Miku en toda la app = el cebollín** en un círculo `#0E1D20` con borde turquesa 45 %.

### 6.2 Configuración inicial (`SetupScreen`)
- Ícono de 84 dp, «Miku» (Dela 30 sp) y «Pon las claves una sola vez. Se guardan cifradas en este teléfono.»
- Un campo de contraseña por clave: alto 52, botón de ojo de 44 dp y ayuda de 12 sp debajo.
- Botón «Guardar y empezar» de 56 dp de alto; deshabilitado hasta completar los campos.
- **Ajustar los campos a los reales de `SetupScreen.kt`:** la maqueta asume clave de OpenRouter y token de GitHub, y no se pudo leer ese archivo desde aquí.

### 6.3 Chat (`ChatScreen`)
- **Cabecera** (alto 68, debajo de la barra de estado del sistema): avatar de 40 · «Miku» · estado en Chakra 10 sp (`«HEY MIKU» ACTIVO` / `PENSANDO…`) · historial de voz (reloj) · ajustes.
- **Burbujas:**
  - Las de él: fondo `rgba(240,80,143,0.14)`, borde rosa 32 %, cola abajo a la derecha.
  - Las de Miku: fondo `rgba(234,244,243,0.06)`, borde turquesa 24 %, cola abajo a la izquierda.
  - Ancho máximo del 78–82 %.
- **Historial de voz dentro del chat:** separador `POR VOZ · 14:32` con icono de micrófono. Lo que él dijo por voz va en burbuja de **borde punteado sin relleno**.
- **«Escribiendo»:** burbuja de Miku con 3 puntos turquesa (parpadeo 1,2 s escalonado) y, debajo, **el mismo rastro de tools que en escritorio** (categoría + texto humano). Reusar las etiquetas de `toolLabels`.
- **Miku hablando:** barra sobre el campo (alto 48, fondo rosa 10 %, borde rosa 35 %) con mini tira de teclas rosa, «Miku está hablando» y detener (36 dp). Reemplaza el botón suelto de detener audio.
- **Campo:** adjuntar foto (44, con contorno) · campo redondo «Escríbele a Miku…» · enviar (44, turquesa; gris deshabilitado si está vacío).
- **Foto adjunta:** tarjeta encima del campo (fondo turquesa 8 %, borde 35 %) con miniatura de 48, «Foto lista para enviar», `SE MANDA CON TU MENSAJE` y ✕. El botón de adjuntar queda marcado.

### 6.4 Configuración
Pasa de hoja a **pantalla propia** con botón atrás. Si se prefiere seguir con hoja, el contenido es el mismo.

- **Secciones con etiqueta numerada:**
  - `01 HEY MIKU`: interruptor; permiso de mostrarse sobre otras apps (✓ «Listo» o botón «Permitir»); batería («Que no le corten el micrófono», fila en rosa con «Permitir» si falta).
  - `02 VOZ REAL DE MIKU`: tarjeta de voz.
  - `03 CONEXIONES`: Spotify «Reconectar»; Gmail con n cuentas y flecha a su lista; Calendar «Conectar».
  - `04 MEMORIA`: «Recargar».
  - `05 CUENTA`: «Borrar claves y cerrar sesión» en rosa.
  - Pie: `MIKU-AI · VERSIÓN [versionName]`.
- **Tarjeta de voz (4 estados):**
  - Sin descargar: «Descargar», primario, 518 MB.
  - Descargando: tira de teclas de 28 + «233 DE 518 MB» + %.
  - Falló: tarjeta rosa + «Reintentar».
  - Lista: ✓ + «Actualizar» solo si hay una versión nueva.
- Interruptor de 52 × 32 dp.

### 6.5 Ventana flotante «Hey Miku» (`MikuOverlayUi`)
- Tarjeta abajo, flotando sobre cualquier app: márgenes 12 a los lados, 28 abajo, radio 28, fondo `rgba(9,20,23,0.97)`, borde turquesa 35 %, contorno oscuro + sombra.
- Detrás, un degradado oscuro de 420 dp de alto (0 → 55 %) para separarla de apps claras.
- **Fila de arriba:** cebollín 48 dp · estado · cerrar (44 dp, fondo 6 %).
- **Escuchando:** borde rosa y **halos rosas que pulsan** (5 y 11 dp). Transcripción parcial a 20 sp, con lo no confirmado en `--m-dim`.
- **Pensando:** halo turquesa fijo, eco «TÚ · …» y rastro de tools.
- **Respondiendo:** `MIKU`, texto a 17 sp peso 500 con la última palabra estilo karaoke, tira de teclas rosa, detener (44 dp) y el enlace «Abrir el chat».
- El texto se revela cuando el audio empieza a sonar (como hoy).

### 6.6 Widget «Hablar con Miku»
- 4 × 1, alto 76, radio 26, fondo `rgba(9,20,23,0.94)`, borde turquesa 35 %.
- Contenido: cebollín 48 · «Hablar con Miku» (16 sp, 700) · estado · botón de micrófono 52.
- Con «Hey Miku» apagado: borde gris, ícono al 70 %, micrófono con contorno y `TOCAR PRENDE «HEY MIKU»`. Es la degradación que ya existe.

### 6.7 Acceso rápido (Quick Settings)
Android dibuja la ficha: solo se controla el **ícono** (`ic_stat_miku`), el título «Hey Miku» y el subtítulo «Escuchando» / «Apagado» (`Tile.subtitle`, API 29+).

### 6.8 Notificaciones
El sistema las dibuja. Se controlan el ícono (`ic_stat_miku`), el color (`setColor(0xFF39C5BB)`), los textos y las acciones.

| Tipo | Título | Texto | Acción |
|---|---|---|---|
| Servicio «Hey Miku» (en curso, silenciosa) | «Miku te escucha» | «Di «Hey Miku» para hablarle.» | **PROPUESTA:** «Pausar» |
| Recordatorio | el texto del recordatorio | «Me pediste que te lo recordara a las [hora].» | — |
| Evento por empezar | «En 20 minutos: [evento]» | «A las [hora].» | — |
| Correo nuevo | [remitente] | [asunto] | — |
| Resumen agrupado | «Mientras no estabas» | «2 correos nuevos · 1 evento esta semana» | **PROPUESTA:** «Contarme» (abre la ventana flotante y lo lee) |

---

## 7. Orden sugerido para implementar

**Escritorio**
1. Tokens nuevos + iconos + estados de hover/foco/presionado.
2. Legibilidad (§5).
3. Movimiento (§4).
4. Diálogo propio + Memoria (corregir, olvidar, pestaña Tacto).
5. Quirks.
6. Apps y carpetas.
7. Pantalla de carga + soltar archivo.
8. Menú de cámara.
9. Errores y extremos.
10. Combinaciones (lo marcado PROPUESTA, solo si se aprueba).

**Android**
1. Tema + tipografías + ícono (`android-icono/`).
2. Chat.
3. Ventana flotante.
4. Configuración.
5. Setup.
6. Widget, ficha y notificaciones.

Una tarea a la vez, confirmando en vivo antes de seguir, como en la ronda 1.
