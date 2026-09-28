package com.sebas.mikuai.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.sebas.mikuai.R

// Las tres tipografías del diseño (DISENO.md §6.1), empaquetadas en
// res/font (subconjunto latino: cubre todo el español).
val DelaGothic = FontFamily(Font(R.font.dela_gothic_one, FontWeight.Normal))
val ChakraPetch = FontFamily(Font(R.font.chakra_petch_semibold, FontWeight.SemiBold))
val ZenKaku = FontFamily(
    Font(R.font.zen_kaku_gothic_new_regular, FontWeight.Normal),
    Font(R.font.zen_kaku_gothic_new_medium, FontWeight.Medium),
    Font(R.font.zen_kaku_gothic_new_bold, FontWeight.Bold),
)

// Etiquetas tipo consola: Chakra Petch 11 sp, MAYÚSCULAS (el texto ya se
// escribe en mayúsculas), espaciado 0.12em.
val MikuLabel = TextStyle(
    fontFamily = ChakraPetch,
    fontWeight = FontWeight.SemiBold,
    fontSize = 11.sp,
    letterSpacing = 0.12.em,
)

val Typography = Typography(
    // Títulos de pantalla: Dela Gothic One 22 sp.
    titleLarge = TextStyle(fontFamily = DelaGothic, fontSize = 22.sp, lineHeight = 28.sp),
    // «Miku» en la cabecera del chat: 19 sp.
    titleMedium = TextStyle(fontFamily = DelaGothic, fontSize = 19.sp, lineHeight = 24.sp),
    titleSmall = TextStyle(fontFamily = ZenKaku, fontWeight = FontWeight.Bold, fontSize = 15.sp, lineHeight = 21.sp),
    // Cuerpo y burbujas: 15 sp.
    bodyLarge = TextStyle(fontFamily = ZenKaku, fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = ZenKaku, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = ZenKaku, fontSize = 12.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontFamily = ZenKaku, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = MikuLabel,
    labelSmall = MikuLabel.copy(fontSize = 10.sp),
)
