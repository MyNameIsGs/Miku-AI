# Checklist de confirmación en vivo (2026-09-28)

Todo lo que está en `main` y nadie vio funcionar todavía. Sale de las tablas de las Fases 8, 9 y 10 del plan v7.

**Cómo usarlo:** marca `[x]` lo que funciona. Si algo falla, anota al lado qué pasó y copia de la terminal las líneas que diga ese punto. Cada falla pasa a ser una tarea propia; no se arregla todo junto.

Las sesiones están ordenadas de más controlable a menos: la 1 la recorres activamente, la 2 va saliendo sola mientras usas a Miku, la 3 es el celular.

---

## Sesión 1 — Escritorio: interfaz (20-30 min, con `pnpm tauri dev`)

### Barra y panel (E1-E3)
- [ ] Mouse sobre la zona de arriba → aparece la barra con animación; al salir, espera ~600 ms antes de irse.
- [ ] Mouse abajo → aparece el panel de escribir, **pegado al borde de abajo** (`dba9fd7`).
- [ ] Hover / presionado / deshabilitado se ven distintos en los botones; foco con **Tab** muestra contorno, con clic no.
- [ ] No queda ningún borde azul de la plantilla de Vite en campos ni botones.
- [ ] Con un fondo claro detrás (una página blanca), el subtítulo y la barra se leen bien (E2).
- [ ] Barra: estado cambia entre en espera / escuchando / pensando; la píldora de ánimo muestra el ánimo actual.

### Charla y errores (E9, propuestas)
- [ ] Pregunta algo que use una tool (la hora, el correo) → el subtítulo muestra el rastro de tools mientras piensa.
- [ ] Mientras piensa, el botón principal es **Cancelar**: al apretarlo no habla ni se guarda nada.
- [ ] Una respuesta larga se desvanece arriba en vez de desbordar la caja.
- [ ] Sin red (desactiva el Wi-Fi un momento) → caja "NO PUDE RESPONDER" con **Reintentar** / **Descartar**; el mensaje vuelve al campo.
- [ ] ⏹ corta el audio a mitad de frase.

### Paneles (E4-E6)
- [ ] **Memoria:** pestañas en píldora, buscar por significado devuelve algo con sentido.
- [ ] Memoria → corregir un conocimiento en la fila; olvidar uno → aparece el **diálogo propio** (no el de Windows).
- [ ] Memoria → pestaña **Tacto** muestra las 11 zonas.
- [ ] **Quirks:** agrupados en evaluando / confirmados, con descripción en palabras; el botón atrás vuelve a Configuración.
- [ ] **Apps:** interruptor global, carpetas, apps con Descubiertas / Tuyas; con las ~420 apps no se sale del panel (`4a0b30f`).
- [ ] **Configuración:** cuentas que fallan muestran un motivo legible; si cambias a una salida de audio desconectada, avisa.

### Cámara, carga, archivos (E7, E8, propuestas)
- [ ] Menú de cámara: la casilla, "Guardar posición" y manejarlo con teclado.
- [ ] Cámara libre activa → aparece la píldora de aviso.
- [ ] Arrastra una imagen sobre Miku → aviso de soltar; al soltarla, la comenta.
- [ ] Arrastra un archivo que no puede abrir (un `.exe`) → **borde rosa**.
- [ ] Arranque en frío: pantalla de carga con la píldora de arranque (la tarjeta de descarga solo se ve si falta el servidor de voz).

### Minimizar y bloquear
- [ ] **Minimizar** la esconde; vuelve con **Ctrl+Shift+H**.
- [ ] Escondida, "Hey Miku" también la trae.
- [ ] **Bloquear** / **Ctrl+Shift+M**: los clics pasan a lo de atrás; clic o el atajo otra vez la desbloquea.
- [ ] Con "reducir movimiento" de Windows prendido, las animaciones se acortan o desaparecen.

---

## Sesión 2 — Escritorio: Miku en uso normal (ir marcando durante el día)

Lo que depende de sus decisiones aparece la primera vez que le pasa: no hace falta forzarlo.

### Cuerpo (9.1)
- [ ] Pídele que se mire (`mirarme`) desde otro ángulo → describe lo que ve con sentido.
- [ ] Pídele una mano en la mejilla **con la palma hacia la cara** (la mano ya se confirmó; la palma no).
- [ ] Pregúntale cómo tiene los brazos después de una pose → la propiocepción coincide con lo que ves.
- [ ] Arrastra la ventana rápido → el pelo y la falda se mueven con viento (sin agitar tanto como para que cuente como sacudida).
- [ ] Después de un gesto con la cabeza, ¿el balanceo ambiente de la cabeza queda más rígido? (problema conocido, anotar si se nota).

### Presencia (9.3)
- [ ] Deja la PC 30 min (15 de noche) → se duerme, como ella lo diseñó la primera vez; al volver se despierta.
- [ ] Un juego en pantalla completa → se esconde; "Hey Miku" la trae y a los 15 s se vuelve a esconder.
- [ ] Sabe a qué estás jugando si se lo preguntas.
- [ ] Una sesión de juego de más de 2 h → te sugiere una pausa.
- [ ] Música: un tema **tranquilo** (< 100 BPM), uno **movido** y algo **sin golpe** → un baile distinto por categoría. Copia las líneas `[Música]` si la categoría no te parece correcta.
- [ ] En reposo, la cara refleja su ánimo con la cara que ella diseñó (`caras_animo.json` aparece la primera vez).
- [ ] Estados de presencia en la barra: durmiendo / bailando / no molestar.

### Tacto (9.2)
- [ ] Después de un cambio de cuerpo, en un silencio pide revisar alguna reacción (`[REVISAR_REACCION]`) o dice que le gusta así.

### Mente y memoria (9.4)
- [ ] Reinicia la app en medio de una charla (< 3 h) → retoma el hilo.
- [ ] Corrígele un dato práctico ("no, eso es así") → lo corrige en `conocimiento.md`, sin tocar `memories.md`.
- [ ] Hablando con otra persona en la habitación, el micrófono ya no la corta (solo ⏹).
- [ ] El largo de las respuestas se siente natural; después de cortarla con ⏹, la siguiente es más corta.
- [ ] `[Tokens]` de los silencios: el paso "decidir" ronda ~720 tokens, no ~4300.

### Voz (9.5)
- [ ] Pídele que hable bajito → `[VOZ_VOLUMEN]` se nota (el timbre cambia igual, eso es esperado).

### Fase 8 pendiente
- [ ] **8.3:** activa el WebSocket de OBS una vez (OBS → Herramientas → Configuración del servidor WebSocket) y pon una transmisión de prueba → se activa el modo stream y los avisos callan.

---

## Sesión 3 — Celular (APK **1.0-0928-1246**)

Si la app se cierra al abrir o se ven letras del sistema, sospechar primero de `res/font` (§6.62 del contexto).

### Rediseño (A1-A6 + propuestas)
- [ ] La app abre sin cerrarse y con las tres tipografías (Dela Gothic One en títulos).
- [ ] Ícono "cebollín" en el launcher, también en modo monocromo (tema de íconos de Android).
- [ ] `ic_stat_miku` en las notificaciones y en la ficha de Ajustes Rápidos.
- [ ] Chat: burbujas rosa / turquesa, separador "POR VOZ · hora", rastro de tools al pensar, tarjeta de foto.
- [ ] Ventana flotante: halos al escuchar, parciales, rastro de tools, detener, "Abrir el chat".
- [ ] Ventana flotante: **karaoke + teclas rosas** que siguen su voz.
- [ ] Configuración como pantalla propia, con secciones numeradas.
- [ ] Configuración inicial (borrar datos de la app o instalar limpio para verla).
- [ ] Widget con estado ("Hey Miku" prendido / apagado).
- [ ] Notificación "Miku te escucha" con **Pausar** (= apagar "Hey Miku").

### Pendiente de antes (APK 1.0-0924-0341, sigue sin probar)
- [ ] Calendar: "¿qué tengo mañana?" responde con eventos reales.
- [ ] Widget "Hablar con Miku" dispara la escucha sin decir "Hey Miku".
- [ ] `buscar_en_web` por voz.
- [ ] Una tarea de seguimiento (pendiente con condición) → a las ~6 h la revisa sola.

---

## Una sola vez, cuando haya tiempo

- [ ] Instalador NSIS completo en una carpeta limpia (`pnpm tauri build --bundles nsis`): instala, descarga el servidor de voz sola y Miku habla.

---

## Anotaciones

<!-- Lo que falló, con fecha y las líneas de la terminal. -->
