package com.sebas.mikuai.wakeword

import android.content.Intent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sebas.mikuai.MainActivity
import com.sebas.mikuai.ui.describeTool
import com.sebas.mikuai.ui.theme.MikuAvatar
import com.sebas.mikuai.ui.theme.MikuDim
import com.sebas.mikuai.ui.theme.MikuIcons
import com.sebas.mikuai.ui.theme.MikuLabelText
import com.sebas.mikuai.ui.theme.MikuMuted
import com.sebas.mikuai.ui.theme.MikuPink
import com.sebas.mikuai.ui.theme.MikuPinkText
import com.sebas.mikuai.ui.theme.MikuTeal
import com.sebas.mikuai.ui.theme.MikuText
import com.sebas.mikuai.ui.theme.ZenKaku
import com.sebas.mikuai.voice.VoicePlaybackControl

/**
 * UI compartida de la pantalla flotante estilo "Hey Gemini" -- la usan
 * tanto `MikuOverlayWindow` (ventana de overlay de verdad, `TYPE_APPLICATION_OVERLAY`,
 * el camino principal) como `MikuOverlayActivity` (respaldo vía notificación
 * de pantalla completa, para cuando el usuario no dio el permiso de
 * "superponerse a otras apps"). Separado en su propio archivo para no
 * duplicar la UI entre los dos caminos.
 *
 * Ronda 2 de diseño (docs/diseno-ui-v2/DISENO.md §6.5): tarjeta abajo con
 * el cebollín; escuchando en rosa con halos que pulsan y lo que va
 * entendiendo; pensando con el eco y el rastro de tools; respondiendo con
 * su texto, detener y «Abrir el chat».
 */
@Composable
fun OverlayScreen(phase: MikuOverlayPhase, onDismiss: () -> Unit) {
    val context = LocalContext.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss, // tocar afuera de la tarjeta cierra
            ),
        contentAlignment = Alignment.BottomCenter,
    ) {
        // Degradado oscuro detrás de la tarjeta, para separarla de apps claras.
        Box(
            Modifier
                .fillMaxWidth()
                .height(420.dp)
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.55f))))
        )

        val listening = phase is MikuOverlayPhase.Listening
        val cardShape = RoundedCornerShape(28.dp)
        Column(
            modifier = Modifier
                .navigationBarsPadding()
                .padding(start = 12.dp, end = 12.dp, bottom = 28.dp)
                .fillMaxWidth()
                .shadow(24.dp, cardShape, ambientColor = Color.Black, spotColor = Color.Black)
                .clip(cardShape)
                .background(Color(0xF7091417))
                .border(1.dp, (if (listening) MikuPink else MikuTeal).copy(alpha = 0.35f), cardShape)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {}, // no propagar el toque al fondo
                )
                .padding(start = 18.dp, end = 10.dp, top = 14.dp, bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Fila de arriba: cebollín · estado · cerrar.
            Row(verticalAlignment = Alignment.CenterVertically) {
                HaloAvatar(phase)
                Spacer(Modifier.width(14.dp))
                val (label, color) = when (phase) {
                    is MikuOverlayPhase.Listening -> "ESCUCHANDO" to MikuPinkText
                    is MikuOverlayPhase.Thinking -> "PENSANDO…" to MikuTeal
                    is MikuOverlayPhase.Responding -> "MIKU" to MikuTeal
                    is MikuOverlayPhase.Idle -> "" to MikuMuted
                }
                MikuLabelText(label, color, modifier = Modifier.weight(1f))
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(MikuText.copy(alpha = 0.06f)),
                ) {
                    Icon(MikuIcons.Close, contentDescription = "Cerrar", tint = MikuMuted, modifier = Modifier.size(20.dp))
                }
            }

            AnimatedContent(targetState = phase, label = "overlay-phase") { p ->
                Column(
                    modifier = Modifier.padding(end = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    when (p) {
                        is MikuOverlayPhase.Listening -> {
                            Text(
                                text = p.partial.ifBlank { "…" },
                                color = if (p.partial.isBlank()) MikuDim else MikuText,
                                fontFamily = ZenKaku,
                                fontWeight = FontWeight.Medium,
                                fontSize = 20.sp,
                                lineHeight = 28.sp,
                            )
                        }
                        is MikuOverlayPhase.Thinking -> {
                            if (p.heard.isNotBlank()) {
                                Row {
                                    MikuLabelText("TÚ · ", MikuPinkText)
                                    Text(p.heard, color = MikuMuted, fontFamily = ZenKaku, fontSize = 14.sp, maxLines = 3)
                                }
                            }
                            p.tools.forEach { tool -> ToolRow(tool) }
                        }
                        is MikuOverlayPhase.Responding -> {
                            KaraokeReply(p)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    "Abrir el chat",
                                    color = MikuTeal,
                                    fontFamily = ZenKaku,
                                    fontWeight = FontWeight.Medium,
                                    fontSize = 14.sp,
                                    modifier = Modifier
                                        .weight(1f)
                                        .clickable {
                                            context.startActivity(
                                                Intent(context, MainActivity::class.java)
                                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                                            )
                                            onDismiss()
                                        }
                                        .padding(vertical = 12.dp),
                                )
                                IconButton(
                                    onClick = { VoicePlaybackControl.stopCurrent() },
                                    modifier = Modifier
                                        .size(44.dp)
                                        .clip(CircleShape)
                                        .background(MikuText),
                                ) {
                                    Icon(MikuIcons.Stop, contentDescription = "Detener", tint = Color(0xFF12161A), modifier = Modifier.size(20.dp))
                                }
                            }
                        }
                        is MikuOverlayPhase.Idle -> Spacer(Modifier.height(1.dp))
                    }
                }
            }
        }
    }
}

/**
 * La respuesta revelándose por palabras al ritmo del audio, con la última
 * palabra en turquesa y subrayada en rosa (estilo karaoke), y la tira de
 * teclas rosa siguiendo el nivel de la voz (ronda 2 de diseño, §6.5).
 */
@Composable
private fun KaraokeReply(p: MikuOverlayPhase.Responding) {
    val elapsedMs by produceState(
        initialValue = if (p.durationMs > 0) (System.currentTimeMillis() - p.startedAtMs).coerceAtLeast(0) else Long.MAX_VALUE,
        key1 = p,
    ) {
        if (p.durationMs <= 0) return@produceState
        while (value < p.durationMs + 200) {
            withFrameMillis { }
            value = System.currentTimeMillis() - p.startedAtMs
        }
    }
    val text = p.reply
    val ratio = if (p.durationMs > 0) (elapsedMs.toFloat() / p.durationMs).coerceIn(0f, 1f) else 1f
    val revealing = ratio < 1f
    // Por palabras completas: el punto calculado por tiempo se extiende hasta
    // el final de la palabra en curso (igual que en el escritorio).
    var count = kotlin.math.ceil(ratio * text.length).toInt().coerceIn(if (text.isEmpty()) 0 else 1, text.length)
    while (count < text.length && text[count] != ' ') count++
    val shown = text.substring(0, count)
    val lastWordStart = if (revealing) shown.trimEnd().lastIndexOf(' ') + 1 else shown.length
    val lastWordEnd = shown.trimEnd().length

    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val scroll = rememberScrollState()
    LaunchedEffect(count) { scroll.animateScrollTo(scroll.maxValue) }

    Text(
        text = buildAnnotatedString {
            append(shown.substring(0, lastWordStart.coerceAtMost(shown.length)))
            if (revealing && lastWordEnd > lastWordStart) {
                withStyle(SpanStyle(color = MikuTeal)) { append(shown.substring(lastWordStart, lastWordEnd)) }
                append(shown.substring(lastWordEnd))
            }
        },
        color = MikuText,
        fontFamily = ZenKaku,
        fontWeight = FontWeight.Medium,
        fontSize = 17.sp,
        lineHeight = 25.sp,
        onTextLayout = { layout = it },
        modifier = Modifier
            .heightIn(max = 280.dp)
            .verticalScroll(scroll)
            .drawBehind {
                // Subrayado rosa de 3 dp bajo la última palabra.
                val l = layout ?: return@drawBehind
                if (!revealing || lastWordEnd <= lastWordStart || lastWordEnd > l.layoutInput.text.length) return@drawBehind
                val line = l.getLineForOffset(lastWordStart)
                val x0 = l.getHorizontalPosition(lastWordStart, true)
                val x1 = l.getHorizontalPosition(lastWordEnd, true)
                val y = l.getLineBottom(line) - 1.dp.toPx()
                drawLine(MikuPink, Offset(x0, y), Offset(x1, y), strokeWidth = 3.dp.toPx())
            },
    )

    val levels = p.levels
    if (levels != null && levels.isNotEmpty()) {
        val index = (elapsedMs / MikuOverlayPhase.Responding.LEVEL_STEP_MS).toInt()
        val level = if (revealing && index in levels.indices) levels[index] else 0f
        PianoKeys(level = level * 0.9f, keys = 28)
    }
}

/** Tira de teclas de piano (patrón B N B N B B N B N B N B), en rosa. */
@Composable
private fun PianoKeys(level: Float, keys: Int) {
    val octave = booleanArrayOf(false, true, false, true, false, false, true, false, true, false, true, false)
    val lit = (level.coerceIn(0f, 1f) * keys).toInt()
    Row(
        modifier = Modifier.fillMaxWidth().height(12.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        for (i in 0 until keys) {
            val black = octave[i % 12]
            Box(
                Modifier
                    .weight(1f)
                    .height(if (black) 7.dp else 11.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(
                        when {
                            i < lit && black -> Color(0xFFB83A6C)
                            i < lit -> MikuPink
                            black -> MikuMuted.copy(alpha = 0.22f)
                            else -> MikuText.copy(alpha = 0.12f)
                        }
                    )
            )
        }
    }
}

@Composable
private fun ToolRow(tool: OverlayTool) {
    val (category, text) = describeTool(tool.name, tool.done)
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (tool.done) {
            Box(
                Modifier.size(22.dp).clip(CircleShape).background(MikuTeal.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(MikuIcons.Check, contentDescription = null, tint = MikuTeal, modifier = Modifier.size(13.dp))
            }
        } else {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                color = MikuTeal,
                trackColor = MikuTeal.copy(alpha = 0.25f),
                strokeWidth = 2.dp,
            )
        }
        Spacer(Modifier.width(10.dp))
        MikuLabelText(category, MikuDim, small = true, modifier = Modifier.width(80.dp))
        Text(text, color = MikuText, fontFamily = ZenKaku, fontSize = 14.sp)
    }
}

/**
 * El cebollín (48 dp) con su halo: escuchando, dos halos rosas que pulsan
 * (5 y 11 dp); pensando, un halo turquesa fijo.
 */
@Composable
private fun HaloAvatar(phase: MikuOverlayPhase) {
    val transition = rememberInfiniteTransition(label = "halo")
    val pulse by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "halo-pulse",
    )
    val avatar: Dp = 48.dp
    Box(
        modifier = Modifier
            .size(avatar)
            .drawBehind {
                val r = size.minDimension / 2
                when (phase) {
                    is MikuOverlayPhase.Listening -> {
                        drawCircle(MikuPink.copy(alpha = 0.08f * pulse), radius = r + 11.dp.toPx())
                        drawCircle(MikuPink.copy(alpha = 0.22f * pulse), radius = r + 5.dp.toPx())
                    }
                    is MikuOverlayPhase.Thinking -> {
                        drawCircle(MikuTeal.copy(alpha = 0.18f), radius = r + 5.dp.toPx())
                    }
                    else -> {}
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        MikuAvatar(size = avatar)
    }
}
