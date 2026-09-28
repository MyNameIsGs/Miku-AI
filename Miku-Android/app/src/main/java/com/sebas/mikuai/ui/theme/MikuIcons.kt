package com.sebas.mikuai.ui.theme

import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color

// Iconos de trazo de la ronda 2 de diseño (mismos paths SVG que el
// escritorio, viewBox 24, trazo 1.8, extremos redondeados). Reemplazan los
// emojis de la UI (⚙️ 🔋 🖼️ ↺). Se tiñen con el `tint` de Icon().

private fun circle(cx: Float, cy: Float, r: Float) =
    "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0"

private fun roundRect(x: Float, y: Float, w: Float, h: Float, r: Float) =
    "M${x + r} ${y}h${w - 2 * r}a$r $r 0 0 1 $r ${r}v${h - 2 * r}a$r $r 0 0 1 ${-r} ${r}" +
        "h${-(w - 2 * r)}a$r $r 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a$r $r 0 0 1 $r ${-r}z"

private fun strokeIcon(name: String, vararg paths: String, strokeWidth: Float = 1.8f): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        paths.forEach { d ->
            addPath(
                pathData = addPathNodes(d),
                fill = null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = strokeWidth,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()

private fun fillIcon(name: String, vararg paths: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        paths.forEach { d -> addPath(pathData = addPathNodes(d), fill = SolidColor(Color.Black)) }
    }.build()

object MikuIcons {
    val Settings = strokeIcon("settings", "M4 7h10M18 7h2M4 17h4M12 17h8", circle(16f, 7f, 2f), circle(10f, 17f, 2f))
    val Clock = strokeIcon("clock", circle(12f, 12f, 8.5f), "M12 7.5V12l3 2")
    val Mic = strokeIcon("mic", roundRect(9f, 3f, 6f, 11f, 3f), "M5 11a7 7 0 0 0 14 0M12 18v3")
    val Stop = fillIcon("stop", roundRect(6f, 6f, 12f, 12f, 2f))
    val Image = strokeIcon("image", roundRect(3.5f, 5f, 17f, 14f, 2f), circle(9f, 10f, 1.8f), "M4 17l5-4.5 4 3.5 3-2.5 4.5 4")
    val Send = strokeIcon("send", "M5 12h14M13 6l6 6-6 6", strokeWidth = 2f)
    val Check = strokeIcon("check", "M5 12.5l4.5 4.5L19 7.5", strokeWidth = 2.4f)
    val Close = strokeIcon("close", "M6 6l12 12M18 6L6 18")
    val Back = strokeIcon("back", "M15 5l-7 7 7 7")
    val ChevronRight = strokeIcon("chevron_right", "M9 6l6 6-6 6")
    val Reload = strokeIcon("reload", "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6")
    val Logout = strokeIcon("logout", "M10 5H5v14h5M14 8l4 4-4 4M18 12H9")
    val Download = strokeIcon("download", "M12 4v11M7 10l5 5 5-5M5 20h14")
    val Alert = strokeIcon("alert", circle(12f, 12f, 9f), "M12 7.5v5.5M12 16.5v.01")
    val Eye = strokeIcon("eye", "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z", circle(12f, 12f, 3f))
    val EyeOff = strokeIcon(
        "eye_off",
        "M3 3l18 18M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.6M6.4 6.5A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 4.2-1",
    )
    val Battery = strokeIcon("battery", roundRect(3f, 7f, 16f, 10f, 2.5f), "M22 11v2M7 10.5v3M11 10.5v3")
    val Layers = strokeIcon("layers", roundRect(4f, 4f, 12f, 12f, 2f), "M8 20h10a2 2 0 0 0 2-2V8")
}
