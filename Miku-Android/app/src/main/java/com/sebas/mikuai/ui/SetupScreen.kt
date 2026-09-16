package com.sebas.mikuai.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sebas.mikuai.data.SecurePrefs
import com.sebas.mikuai.ui.theme.*

@Composable
fun SetupScreen(onCredentialsSaved: () -> Unit) {
    val context      = LocalContext.current
    val focusManager = LocalFocusManager.current
    val prefs        = remember { SecurePrefs(context) }

    var ghToken  by remember { mutableStateOf("") }
    var orKey    by remember { mutableStateOf("") }
    var loading  by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MikuBg)
            .padding(WindowInsets.systemBars.asPaddingValues()),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier            = Modifier
                .fillMaxWidth()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Text(
                text       = "初音ミク",
                fontSize   = 40.sp,
                fontWeight = FontWeight.ExtraBold,
                color      = MikuTeal
            )
            Text(
                text     = "Ingresa tus claves para conectar con Miku",
                color    = MikuTextDim,
                fontSize = 14.sp
            )

            CredentialField(
                label       = "GitHub Personal Access Token",
                hint        = "ghp_… · Permiso Contents lectura+escritura en Miku-AI",
                value       = ghToken,
                onValueChange = { ghToken = it },
                imeAction   = ImeAction.Next,
                onImeAction = { focusManager.moveFocus(FocusDirection.Down) }
            )
            CredentialField(
                label       = "OpenRouter API Key",
                hint        = "sk-or-…",
                value       = orKey,
                onValueChange = { orKey = it },
                imeAction   = ImeAction.Done,
                onImeAction = { focusManager.clearFocus() }
            )

            Button(
                onClick  = {
                    if (ghToken.isBlank() || orKey.isBlank()) return@Button
                    loading = true
                    prefs.setGitHubToken(ghToken.trim())
                    prefs.setOpenRouterKey(orKey.trim())
                    onCredentialsSaved()
                },
                enabled  = ghToken.isNotBlank() && orKey.isNotBlank() && !loading,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors   = ButtonDefaults.buttonColors(containerColor = MikuTeal)
            ) {
                Text("Conectar", color = MikuBg, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
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
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = MikuTeal, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(
            value         = value,
            onValueChange = onValueChange,
            modifier      = Modifier.fillMaxWidth(),
            singleLine    = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions  = KeyboardOptions(imeAction = imeAction),
            keyboardActions  = KeyboardActions(onAny = { onImeAction() }),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor   = MikuTeal,
                unfocusedBorderColor = MikuBorder,
                focusedTextColor     = MikuText,
                unfocusedTextColor   = MikuText,
                cursorColor          = MikuTeal
            )
        )
        Text(hint, color = MikuTextDim, fontSize = 11.sp)
    }
}