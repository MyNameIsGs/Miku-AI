# Ícono de Miku-AI (Android) — "Cebollín"

Dirección elegida: **E · Cebollín** (canvas de diseño, lámina "Ícono de la app"). Todo es VectorDrawable: no hacen falta PNG por densidad.

## Dónde va cada archivo

| Archivo | Destino en `Miku-Android/app/src/main/res/` | Qué es |
|---|---|---|
| `ic_launcher_background.xml` | `drawable/` | Capa de fondo del adaptive icon: `#0E1D20` liso |
| `ic_launcher_foreground.xml` | `drawable/` | Capa frontal: cebollín a color (hojas `#39C5BB` / `#2A9D95`, tallo `#EAF4F3`, lazo `#F0508F`), inclinado −30°, dentro de la zona segura de 66 dp |
| `ic_launcher_monochrome.xml` | `drawable/` | Capa monocroma para íconos temáticos (Android 13+). El lazo rosa pasa a ser un **hueco** entre hojas y tallo |
| `ic_launcher.xml` | `mipmap-anydpi-v26/` | Adaptive icon (fondo + frente + monocroma) |
| `ic_launcher_round.xml` | `mipmap-anydpi-v26/` | Igual, para launchers que piden el redondo |
| `ic_stat_miku.xml` | `drawable/` | Ícono de notificación, 24 dp, blanco sobre transparente (misma silueta que la monocroma) |

## Pasos para Claude Code

1. Copiar los archivos a sus carpetas. Si ya existen `ic_launcher*.xml` o PNG `ic_launcher*` en `mipmap-*`, reemplazar los XML y **borrar los PNG viejos** de `mipmap-mdpi` … `mipmap-xxxhdpi` solo si `minSdk ≥ 26` (si es menor, avisar antes: hacen falta PNG de respaldo).
2. Confirmar que `AndroidManifest.xml` use `android:icon="@mipmap/ic_launcher"` y `android:roundIcon="@mipmap/ic_launcher_round"`.
3. Usar `R.drawable.ic_stat_miku` como `setSmallIcon(...)` en **todas** las notificaciones (servicio de "Hey Miku", recordatorios, correo, eventos, resumen). Para el widget y la ficha de Ajustes Rápidos también sirve `ic_stat_miku`.
4. Opcional: `setColor(0xFF39C5BB)` en las notificaciones para que el ícono se tiña turquesa donde el sistema lo permite.
5. Compilar con `gradlew assembleDebug --no-configuration-cache`, instalar y revisar: ícono normal, ícono con "íconos temáticos" activado, y una notificación.

## Si algo se ve mal en el teléfono

- **Se ve chico o grande dentro de la máscara:** ajustar `android:scaleX/scaleY` del grupo principal (hoy `0.85` en frente y monocroma; `1.3` en la de notificación).
- **En la monocroma, las tres hojas se funden:** es esperado en parte (se tocan en la base). Si molesta, bajar la rotación de las hojas laterales de ±16° a ±20°.
