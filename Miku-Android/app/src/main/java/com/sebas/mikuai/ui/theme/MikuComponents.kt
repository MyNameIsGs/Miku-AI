package com.sebas.mikuai.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.sebas.mikuai.R

// Piezas compartidas de la ronda 2 de diseño (DISENO.md §6).

/** El avatar de Miku en toda la app: el cebollín en un círculo #0E1D20 con
 *  borde turquesa al 45 %. */
@Composable
fun MikuAvatar(size: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(MikuAvatarBg)
            .border(1.dp, MikuTeal.copy(alpha = 0.45f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        // La capa frontal del ícono deja márgenes de zona segura: se agranda
        // un poco para que el cebollín llene el círculo.
        Image(
            painter = painterResource(R.drawable.ic_launcher_foreground),
            contentDescription = null,
            modifier = Modifier.requiredSize(size * 1.45f),
        )
    }
}

/** Etiqueta tipo consola (Chakra Petch, MAYÚSCULAS). */
@Composable
fun MikuLabelText(text: String, color: Color, modifier: Modifier = Modifier, small: Boolean = false) {
    Text(
        text = text,
        color = color,
        style = if (small) MikuLabel.copy(fontSize = MikuLabel.fontSize * 10f / 11f) else MikuLabel,
        modifier = modifier,
    )
}

/** Borde punteado redondeado (burbujas de lo dicho por voz). */
fun Modifier.dashedBorder(color: Color, radius: Dp, width: Dp = 1.dp): Modifier = drawBehind {
    val stroke = width.toPx()
    drawRoundRect(
        color = color,
        topLeft = androidx.compose.ui.geometry.Offset(stroke / 2, stroke / 2),
        size = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke),
        cornerRadius = CornerRadius(radius.toPx()),
        style = Stroke(width = stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))),
    )
}
