package com.sebas.mikuai.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Tema de la ronda 2 (DISENO.md §6.1). Modo oscuro como base; el claro
// queda fuera hasta que se pida.
private val MikuColorScheme = darkColorScheme(
    primary              = MikuTeal,
    onPrimary            = MikuOnTeal,
    primaryContainer     = MikuTealDim,
    onPrimaryContainer   = MikuText,
    secondary            = MikuPink,
    onSecondary          = MikuOnPink,
    background           = MikuBg,
    onBackground         = MikuText,
    surface              = MikuBg,
    onSurface            = MikuText,
    surfaceVariant       = MikuCard,
    onSurfaceVariant     = MikuMuted,
    surfaceContainer     = MikuCard,
    surfaceContainerHigh = MikuSurface2,
    outline              = MikuOutline,
    outlineVariant       = MikuCardBorder,
    error                = MikuPinkText,
    onError              = MikuOnPink,
    errorContainer       = Color(0x0FF0508F),
)

@Composable
fun MikuTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MikuColorScheme,
        typography  = Typography,
        content     = content
    )
}
