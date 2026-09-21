package com.sebas.mikuai.wakeword

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sebas.mikuai.ui.theme.MikuSurface
import com.sebas.mikuai.ui.theme.MikuTeal
import com.sebas.mikuai.ui.theme.MikuText
import com.sebas.mikuai.ui.theme.MikuTextDim

/**
 * UI compartida de la pantalla flotante estilo "Hey Gemini" -- la usan
 * tanto `MikuOverlayWindow` (ventana de overlay de verdad, `TYPE_APPLICATION_OVERLAY`,
 * el camino principal) como `MikuOverlayActivity` (respaldo vía notificación
 * de pantalla completa, para cuando el usuario no dio el permiso de
 * "superponerse a otras apps"). Separado en su propio archivo para no
 * duplicar la UI entre los dos caminos.
 */
@Composable
fun OverlayScreen(phase: MikuOverlayPhase, onDismiss: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.35f))
            .clickable(onClick = onDismiss), // tocar afuera de la tarjeta cierra
        contentAlignment = Alignment.BottomCenter,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .navigationBarsPadding()
                .clip(RoundedCornerShape(28.dp))
                .background(MikuSurface)
                .clickable(enabled = false) {} // no propagar el click al scrim
                .padding(horizontal = 20.dp, vertical = 18.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PulsingMikuIcon(active = phase !is MikuOverlayPhase.Idle)
                Spacer(modifier = Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    AnimatedContent(targetState = phase, label = "overlay-phase") { p ->
                        when (p) {
                            is MikuOverlayPhase.Listening -> {
                                Text("Escuchando…", color = MikuText, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                            }
                            is MikuOverlayPhase.Thinking -> {
                                Text("Pensando…", color = MikuText, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                            }
                            is MikuOverlayPhase.Responding -> {
                                Column {
                                    if (p.heard.isNotBlank()) {
                                        Text(p.heard, color = MikuTextDim, fontSize = 13.sp, maxLines = 2)
                                        Spacer(modifier = Modifier.height(4.dp))
                                    }
                                    Text(p.reply, color = MikuText, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                                }
                            }
                            is MikuOverlayPhase.Idle -> {
                                Text("", color = MikuText, fontSize = 16.sp)
                            }
                        }
                    }
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Cerrar", tint = MikuTextDim)
                }
            }
        }
    }
}

@Composable
private fun PulsingMikuIcon(active: Boolean) {
    val transition = rememberInfiniteTransition(label = "mic-pulse")
    val scale by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (active) 1.15f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(700),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "mic-pulse-scale",
    )
    Box(
        modifier = Modifier
            .size(40.dp)
            .scale(scale)
            .clip(CircleShape)
            .background(MikuTeal.copy(alpha = 0.18f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Default.Mic, contentDescription = null, tint = MikuTeal, modifier = Modifier.size(20.dp))
    }
}
