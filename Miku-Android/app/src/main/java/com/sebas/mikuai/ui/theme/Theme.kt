package com.sebas.mikuai.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val MikuColorScheme = darkColorScheme(
    primary          = MikuTeal,
    onPrimary        = MikuBg,
    primaryContainer = MikuTealDark,
    background       = MikuBg,
    surface          = MikuSurface,
    onBackground     = MikuText,
    onSurface        = MikuText,
    outline          = MikuBorder,
)

@Composable
fun MikuTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MikuColorScheme,
        content     = content
    )
}