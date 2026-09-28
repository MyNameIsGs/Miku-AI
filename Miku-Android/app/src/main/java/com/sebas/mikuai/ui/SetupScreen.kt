package com.sebas.mikuai.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sebas.mikuai.data.SecurePrefs
import com.sebas.mikuai.ui.theme.*

// Configuración inicial, ronda 2 de diseño (docs/diseno-ui-v2/DISENO.md
// §6.2): el cebollín, «Miku» y un campo de contraseña por clave. Solo se ve
// la primera vez (o tras «Borrar claves y cerrar sesión").
@Composable
fun SetupScreen(onCredentialsSaved: () -> Unit) {
    val context      = LocalContext.current
    val focusManager = LocalFocusManager.current
    val prefs        = remember { SecurePrefs(context) }

    var ghToken  by remember { mutableStateOf("") }
    var orKey    by remember { mutableStateOf("") }
    var loading  by remember { mutableStateOf(false) }
    val canSave = ghToken.isNotBlank() && orKey.isNotBlank() && !loading

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MikuBg)
            .padding(WindowInsets.systemBars.asPaddingValues())
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Spacer(Modifier.height(12.dp))
        MikuAvatar(size = 84.dp)
        Text("Miku", fontFamily = DelaGothic, fontSize = 30.sp, color = MikuText)
        Text(
            text = "Pon las claves una sola vez. Se guardan cifradas en este teléfono.",
            color = MikuMuted,
            fontFamily = ZenKaku,
            fontSize = 14.sp,
            lineHeight = 20.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))

        CredentialField(
            label = "TOKEN DE GITHUB",
            hint = "ghp_… · con permiso Contents (lectura y escritura) en Miku-AI. Es donde vive su memoria.",
            value = ghToken,
            onValueChange = { ghToken = it },
            imeAction = ImeAction.Next,
            onImeAction = { focusManager.moveFocus(FocusDirection.Down) },
        )
        CredentialField(
            label = "CLAVE DE OPENROUTER",
            hint = "sk-or-… · es la que usa para pensar y responder.",
            value = orKey,
            onValueChange = { orKey = it },
            imeAction = ImeAction.Done,
            onImeAction = { focusManager.clearFocus() },
        )

        Spacer(Modifier.height(4.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .clip(RoundedCornerShape(28.dp))
                .background(if (canSave) MikuTeal else MikuMuted.copy(alpha = 0.18f))
                .clickable(enabled = canSave) {
                    loading = true
                    prefs.setGitHubToken(ghToken.trim())
                    prefs.setOpenRouterKey(orKey.trim())
                    onCredentialsSaved()
                },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "Guardar y empezar",
                color = if (canSave) MikuOnTeal else Color(0xFF4E6866),
                fontFamily = ZenKaku,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
            )
        }
    }
}

@Composable
private fun CredentialField(
    label: String,
    hint: String,
    value: String,
    onValueChange: (String) -> Unit,
    imeAction: ImeAction,
    onImeAction: () -> Unit
) {
    var visible by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        MikuLabelText(label, MikuTeal)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(MikuText.copy(alpha = 0.05f))
                .border(1.dp, if (focused) MikuTeal else MikuOutline, RoundedCornerShape(14.dp))
                .padding(start = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = imeAction),
                keyboardActions = KeyboardActions(onAny = { onImeAction() }),
                textStyle = Typography.bodyLarge.copy(color = MikuText),
                cursorBrush = SolidColor(MikuTeal),
                modifier = Modifier
                    .weight(1f)
                    .onFocusChanged { focused = it.isFocused },
            )
            IconButton(onClick = { visible = !visible }, modifier = Modifier.size(44.dp)) {
                Icon(
                    if (visible) MikuIcons.EyeOff else MikuIcons.Eye,
                    contentDescription = if (visible) "Ocultar la clave" else "Mostrar la clave",
                    tint = MikuMuted,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Text(hint, color = MikuDim, fontFamily = ZenKaku, fontSize = 12.sp, lineHeight = 17.sp)
    }
}
