# Luces ARGB — plan del control completo

Pedido de Sebastián (2026-10-22): "una interfaz muy muy buena de control ARGB, no algo tan sencillo como ahora; todas las calidades de vida posibles y todas las funciones que le den uso". Este documento es el plan para aprobar antes de implementar. Se hace **una fase a la vez**, y cada fase se confirma en vivo antes de seguir.

Lo que ya existe (commits 7838475 → 737c876): cliente propio del protocolo de OpenRGB (`openrgb.rs`), servicio de OpenRGB 1.1 con PawnIO, tool `controlar_luces`, panel Luces simple (color por zona, asistente de LEDs de los conectores ARGB) y restaurar colores y tamaños al abrir Miku.

Hardware detectado hoy: placa B850 GAMING X WIFI6E (3 conectores ARGB, luz del chipset, luz de la placa), 2 módulos de RAM ENE (8 LEDs cada uno), teclado AULA F87 Pro (102 LEDs), micrófono HyperX Quadcast S (2 LEDs). En el conector ARGB 2 hay un ventilador de 8 LEDs. **Los ventiladores del gabinete no aparecen** (ver §0).

---

## 0. Antes de todo: los ventiladores del gabinete

Van a un hub propio con su botón o control. Ninguno de los dispositivos USB conectados es un controlador RGB aparte, así que el hub no se puede controlar por software directamente. Hay dos casos:

1. **El hub tiene un cable de entrada ARGB de 3 pines** (casi siempre se llama "M/B SYNC", "ARGB IN" o "5V IN"). Se enchufa a un conector ARGB libre de la placa (el 1 o el 3), y el hub se pasa a modo sincronización. Según el modelo, eso es mantener apretado su botón unos segundos o elegir "M/B" en el control. A partir de ahí la placa le manda los colores, y aparece en el panel como un conector más (con el asistente de LEDs).
2. **El hub no tiene ese cable** (solo SATA y su control): no hay forma de controlarlo por software. Habría que cambiar el hub, o conectar los ventiladores directo a los conectores de la placa, con un divisor ARGB si son más de tres.

Para saber cuál es, hace falta el modelo del gabinete o del hub, o una foto del hub y sus cables.

---

## 1. Arquitectura

- **El motor de efectos vive en Rust**, en un hilo propio a 30 cuadros por segundo (configurable de 10 a 60). No vive en el frontend porque, con Miku escondida (modo juego), WebView2 frena los temporizadores, y los efectos se congelarían justo cuando más se ven.
- **Conexión persistente con OpenRGB** para el motor (hoy es una por pedido). Se reconecta sola si el servicio se reinicia.
- **Un "frame"** es el color de cada LED de cada zona. El motor los calcula y los manda con `UPDATEZONELEDS`, y solo manda las zonas que cambiaron.
- **La vista previa del panel** recibe los mismos frames por un evento de Tauri (a 20 fps, y solo con el panel abierto). Lo que ves en el panel es exactamente lo que hacen las luces.
- **Todo se describe como datos:** una *escena* es una lista de *capas* sobre *grupos* de zonas. La guarda el frontend (`.settings.dat`), y Miku la puede leer y escribir con su tool.
- **Las zonas tienen posición en un mapa 2D del gabinete.** Así los efectos espaciales, como una ola que cruza todo el PC, recorren el gabinete de verdad y no cada dispositivo por separado.

---

## 2. Efectos

Cada efecto tiene sus parámetros: colores (1 a N, o un degradado), velocidad, brillo, dirección, tamaño o densidad, y suavidad.

**Básicos**
- **Estático:** un color, o un degradado a lo largo de la zona.
- **Respirar:** sube y baja, con 1 o más colores alternados.
- **Arcoíris:** recorre el espectro, por LED (ola) o la zona entera junta (ciclo).
- **Ola:** una banda de color que viaja (dirección y ancho configurables). Es espacial: cruza el gabinete según el mapa.
- **Cometa / persecución:** un punto con estela que corre por la zona. En los ventiladores gira en el anillo.
- **Destellos:** LEDs al azar que se prenden y se apagan (densidad y colores).
- **Fuego:** parpadeo cálido.
- **Latido:** doble pulso.
- **Degradado animado:** dos o más colores que se mezclan y se desplazan.

**Reactivos** (lo que no tiene ningún software de RGB y Miku sí puede)
- **Música:** usa el análisis que ya existe (`music_beat.rs`, captura del audio de la PC). Hay pulso en cada golpe, brillo según la energía, y color según graves o agudos, con modos "golpe", "vúmetro" y "espectro".
- **Voz de Miku:** cuando habla, las luces respiran con el nivel de su voz (el mismo que mueve su boca). Escuchando → rosa suave; pensando → barrido turquesa (igual que la tira de teclas del panel de controles).
- **Ánimo de Miku:** el color base sigue su ánimo actual, con la intensidad del modelo de ánimo. Los colores por ánimo los elige ella, igual que diseña sus caras.
- **Pantalla (ambilight):** el color promedio del borde de la pantalla, unas 10 veces por segundo. Tiene un modo "solo en juegos".
- **Avisos:** un destello corto al llegar un correo, un recordatorio o un evento por empezar (respetando el no molestar y el modo stream).

**Capas:** una escena puede apilar efectos. Por ejemplo: base arcoíris lento en los ventiladores + RAM según el ánimo + destello encima con los avisos. Cada capa tiene opacidad y modo de mezcla (normal, sumar, multiplicar).

---

## 3. Interfaz

Mismo marco que los paneles de la ronda 1 (726 × 656, tokens `--m-*`, Dela / Chakra / Zen Kaku), pero con **cuatro pestañas** y una **vista previa fija arriba**.

### 3.1 Vista previa (siempre visible, arriba, ~170 px)
- El gabinete dibujado en esquema: cada ventilador como un anillo de sus N LEDs, la RAM como barras, el chipset como un punto, el teclado como una grilla, el micrófono como un círculo. Todo muestra los colores en vivo.
- Al hacer clic en una zona del dibujo, se selecciona (Shift o Ctrl suman a la selección).
- Pasando el mouse por encima: nombre de la zona + cantidad de LEDs.
- Botón **Identificar** con una zona elegida: la hace parpadear en blanco 3 s para encontrarla dentro del gabinete.
- Barra de acciones globales: **interruptor maestro** (apagar todo / volver), **brillo general** (deslizador 0–100 %), **pausar efectos** (quedan quietos en el cuadro actual), y la escena activa con su nombre.

### 3.2 Pestaña «Escena» (la principal)
- **Grupos** a la izquierda: «Todo», «Ventiladores», «RAM», «Placa», «Periféricos», más los que crees tú. Cada uno muestra su efecto actual en una miniatura animada.
- **Editor del efecto** a la derecha, para el grupo elegido:
  - **Galería de efectos** con miniaturas animadas (no una lista de texto).
  - **Parámetros** con controles grandes: deslizadores de velocidad, brillo y tamaño; dirección con flechas; un selector de colores con *paleta propia*, *historial de colores usados*, hex, y **editor de degradado** (puntos arrastrables).
  - Todo cambia **en vivo** mientras arrastras.
- **Capas** debajo: lista ordenable para arrastrar, con ojo (mostrar/ocultar), opacidad y modo de mezcla.
- **Deshacer / rehacer** (Ctrl+Z / Ctrl+Y) para cualquier cambio de la escena.

### 3.3 Pestaña «Dispositivos»
- Lista de todos los dispositivos y zonas, con su estado:
  - **conectado**,
  - **sin configurar** (con el asistente de LEDs, el que ya existe, ampliado),
  - **excluido** (Miku no lo toca y queda con el efecto de su propio software, por ejemplo el teclado si prefieres manejarlo con su app).
- **Asistente de ventiladores ampliado:**
  - Cuántos ventiladores hay en el conector y cuántos LEDs tiene cada uno («3 ventiladores × 8 LEDs»), con la cuenta total automática.
  - **Dónde empieza y hacia dónde gira** cada anillo, para que el cometa gire bien y la ola cruce en el sentido correcto. Se ve en la vista previa.
  - **Prueba de LEDs:** recorre los LEDs de a uno para verificar.
- **Corrección de color por dispositivo:** blanco equilibrado (algunos LEDs dan el blanco azulado o rosado) y brillo máximo por zona, para que la RAM y los ventiladores se vean del mismo tono.
- **Estado de OpenRGB:** si el servicio corre, la versión, el protocolo, el último error, y **Volver a buscar dispositivos**.

### 3.4 Pestaña «Mapa»
- El esquema del gabinete con cada zona arrastrable a su lugar real (frente, arriba, atrás, RAM, placa). Los efectos espaciales usan este mapa.
- Se puede rotar un ventilador (dónde queda su LED 1) y espejar una tira.
- Plantillas para empezar: «gabinete con 3 ventiladores al frente + 1 atrás», etc.
- **Ajuste aprobado (maqueta, 2026-10-22):** en el mapa, el teclado y el micrófono se dibujan con su forma real (un teclado con sus teclas y un micrófono de pie, con los LEDs en su lugar), no como fichas de texto.

### 3.5 Pestaña «Perfiles»
- **Perfiles con nombre:** guardar la escena actual, renombrar, duplicar, borrar (con el diálogo propio de confirmación), marcar como favorito.
- **Cambio rápido** desde el menú de la bandeja de Windows y con atajos (Ctrl+Alt+1…9).
- **Automático**, con reglas en orden de prioridad:
  - **Por juego:** el modo juego ya sabe a qué juegas (por ejemplo, Valorant → rojo / ambilight).
  - **Por horario:** desde las 0:00 brillo al 20 %; o atado al «no molestar».
  - **Por estado de Miku:** durmiendo → luces casi apagadas que respiran lento; bailando → reactivo a la música; en vivo (OBS) → el perfil de stream.
  - **Por ausencia:** si no estás en la PC (Miku ya lo mide), se apaga a los N minutos y vuelve cuando regresas.
  - **Al apagar o suspender Windows:** dejar un color fijo (OpenRGB guarda el modo en la RAM).
- **Importar/exportar** perfiles (archivo `.json`), para respaldo.

### 3.6 Calidad de vida transversal
- **Teclado completo:** Tab o flechas por zonas y efectos; Espacio aplica; Esc cierra.
- **"Reducir movimiento":** las miniaturas quedan quietas, y la vista previa se mantiene porque es información.
- **Ahorro de CPU:** menos fps cuando la escena es estática (0 fps: se manda una vez), y un límite opcional en modo juego.
- **Avisos claros:** «OpenRGB no responde», «Este dispositivo no acepta efectos LED por LED» (algunos solo tienen modos de hardware: se ofrecen esos modos).
- **Modos de hardware** como alternativa: para los dispositivos que los tienen (la placa: Wave, Color Cycle…; la RAM: Rainbow…) se pueden elegir directamente, y siguen funcionando con Miku cerrada.
- **Sin perder nada al cerrar Miku:** al salir, cada dispositivo queda en un color fijo o en un modo de hardware que elijas, no congelado en el último cuadro.

---

## 4. Miku

- **Tool `controlar_luces` ampliada:** elegir perfil, poner un efecto en un grupo con sus parámetros, brillo general, apagar/prender. «Pon las luces moradas que respiren lento» funciona en una sola orden.
- **Efectos propios:** igual que sus quirks, puede diseñar un efecto con nombre ([CREAR_EFECTO_LUZ]) a partir de los efectos base y sus parámetros. Lo prueba, se ve en la vista previa, y queda en la galería con su autoría: «DISEÑADO POR ELLA».
- **«Que Miku lo decida»:** un interruptor en la pestaña Escena. Con él prendido, ella elige y cambia las luces según el momento (música, hora, su ánimo, lo que estés haciendo). Respeta los perfiles automáticos que pusiste tú (los tuyos mandan).
- Nada de hablarle en nombre de Sebastián: sus colores por ánimo y sus efectos los decide ella cuando surgen, como el resto de lo suyo.

---

## 5. Fases (una a la vez, confirmando en vivo)

| Fase | Qué | Se ve al terminar |
|---|---|---|
| **1** | Motor en Rust (conexión persistente, 30 fps, brillo global, interruptor maestro) + efectos básicos + eventos de vista previa | Las luces animadas siguen andando con Miku escondida |
| **2** | Panel nuevo: vista previa en vivo + pestaña Escena (grupos, galería, parámetros, colores, degradado, deshacer) | Elegir y ajustar efectos en vivo desde el panel |
| **3** | Pestaña Dispositivos (asistente ampliado, sentido de giro, excluir, corrección de color, estado) + Mapa | La ola cruza el gabinete en el sentido correcto |
| **4** | Reactivos: música, voz de Miku, ánimo, pantalla, avisos + capas | Las luces siguen la música y a Miku |
| **5** | Perfiles + automático (juego, horario, estado, ausencia) + bandeja y atajos + importar/exportar | Las luces cambian solas según lo que hagas |
| **6** | Miku: tool ampliada, efectos propios, «que Miku lo decida» | Le pides luces en una frase; ella inventa las suyas |

Antes de la fase 2 se puede hacer una **maqueta navegable** del panel para aprobar el diseño, como en las rondas 1 y 2.

---

## 6. Decisiones (respondidas por Sebastián, 2026-10-22)

1. **El hub del gabinete:** va por SATA y hasta ahora solo lo manejó con su control. Antes de darlo por perdido, conviene revisar si tiene un cable de 3 pines escondido (muchos hubs con control lo traen enrollado). Si no lo tiene, queda fuera del software. Las salidas son: conectar los ventiladores directo a los conectores ARGB 1 y 3 de la placa (con un divisor si hace falta), o reemplazar el hub por uno con entrada de sincronización.
2. **Maqueta primero:** sí. `docs/luces-argb/maqueta.html`, antes de la fase 2.
3. **Teclado AULA:** lo maneja Miku, como el resto.
4. **Al cerrar Miku:** las luces quedan en el **color fijo de la escena** actual.
