package com.sebas.mikuai.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import coil.compose.rememberAsyncImagePainter
import com.sebas.mikuai.ui.theme.*
import com.sebas.mikuai.wakeword.WakeWordPrefs
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Chat de Android, ronda 2 de diseño (docs/diseno-ui-v2/DISENO.md §6.3):
// cabecera con el avatar y el estado, burbujas (las tuyas en rosa, las de
// Miku en turquesa), lo dicho por "Hey Miku" en el mismo chat con un
// separador, y mientras piensa, el rastro de tools como en el escritorio.
@Composable
fun ChatScreen(
    vm: ChatViewModel = viewModel(),
    onLogout: () -> Unit
) {
    val uiState     by vm.uiState.collectAsState()
    val listState   = rememberLazyListState()
    val scope       = rememberCoroutineScope()
    val context     = LocalContext.current
    var inputText   by remember { mutableStateOf("") }
    var showSettings by remember { mutableStateOf(false) }
    // Se relee al cerrar Configuración (ahí se prende o apaga).
    var wakeWordEnabled by remember { mutableStateOf(WakeWordPrefs.isEnabled(context)) }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        vm.selectImage(uri)
    }

    // Configuración es una pantalla propia (ronda 2 §6.4), con botón atrás.
    if (showSettings) {
        SettingsScreen(
            vm = vm,
            onBack = {
                showSettings = false
                wakeWordEnabled = WakeWordPrefs.isEnabled(context)
            },
            onLogout = onLogout,
        )
        return
    }

    // Scroll al fondo cuando llega un mensaje nuevo, cambia el estado de
    // carga o aparece una tool nueva.
    LaunchedEffect(uiState.messages.size, uiState.isLoading, uiState.toolTrail.size) {
        val count = uiState.messages.size + if (uiState.isLoading) 1 else 0
        if (count > 0) listState.animateScrollToItem(count - 1)
    }

    val statusText: String
    val statusColor: Color
    when {
        uiState.error != null -> { statusText = uiState.statusText.uppercase(); statusColor = MikuPinkText }
        !uiState.isReady -> { statusText = uiState.statusText.uppercase(); statusColor = MikuDim }
        uiState.isLoading -> { statusText = "PENSANDO…"; statusColor = MikuTeal }
        wakeWordEnabled -> { statusText = "«HEY MIKU» ACTIVO"; statusColor = MikuTeal }
        else -> { statusText = "LISTA"; statusColor = MikuMuted }
    }
    val lastVoiceIndex = uiState.messages.indexOfLast { it.fromVoice && it.role == "user" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MikuBg)
            .padding(WindowInsets.statusBars.asPaddingValues())
    ) {
        // Cabecera (alto 68).
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(68.dp)
                .padding(start = 16.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MikuAvatar(size = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Miku", style = MikuTypography.titleMedium, color = MikuText)
                MikuLabelText(statusText, statusColor, small = true)
            }
            // Historial de voz: va a lo último que se habló por "Hey Miku".
            if (lastVoiceIndex >= 0) {
                IconButton(
                    onClick = { scope.launch { listState.animateScrollToItem(lastVoiceIndex) } },
                    modifier = Modifier.size(44.dp),
                ) {
                    Icon(MikuIcons.Clock, contentDescription = "Historial de voz", tint = MikuMuted, modifier = Modifier.size(22.dp))
                }
            }
            IconButton(
                onClick = { showSettings = true },
                modifier = Modifier.size(44.dp),
            ) {
                Icon(MikuIcons.Settings, contentDescription = "Configuración", tint = MikuMuted, modifier = Modifier.size(22.dp))
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(MikuCardBorder)
        )

        // Mensajes.
        BoxWithConstraints(Modifier.weight(1f)) {
            val maxBubble = maxWidth * 0.8f
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 12.dp),
            ) {
                itemsIndexed(uiState.messages) { _, msg ->
                    if (msg.fromVoice && msg.role == "user") VoiceSeparator(msg.timestampMs)
                    MessageBubble(msg, maxBubble)
                }
                if (uiState.isLoading) {
                    item { TypingBubble(uiState.toolTrail, maxBubble) }
                }
            }
        }

        // Foto adjunta, encima del campo.
        if (uiState.selectedImageUri != null) {
            Row(
                modifier = Modifier
                    .padding(horizontal = 12.dp)
                    .padding(bottom = 8.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(MikuTeal.copy(alpha = 0.08f))
                    .border(1.dp, MikuTeal.copy(alpha = 0.35f), RoundedCornerShape(18.dp))
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Image(
                    painter = rememberAsyncImagePainter(uiState.selectedImageUri),
                    contentDescription = "Foto adjunta",
                    modifier = Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)),
                    contentScale = ContentScale.Crop,
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Foto lista para enviar", color = MikuText, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    MikuLabelText("SE MANDA CON TU MENSAJE", MikuDim, small = true)
                }
                IconButton(onClick = { vm.selectImage(null) }, modifier = Modifier.size(44.dp)) {
                    Icon(MikuIcons.Close, contentDescription = "Quitar foto", tint = MikuMuted, modifier = Modifier.size(20.dp))
                }
            }
        }

        // Campo.
        val canType = uiState.isReady && !uiState.isLoading
        val isSendEnabled = canType && (inputText.isNotBlank() || uiState.selectedImageUri != null)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .padding(bottom = 10.dp)
                .navigationBarsPadding()
                .imePadding(),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val photoMarked = uiState.selectedImageUri != null
            IconButton(
                onClick = {
                    photoPickerLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
                enabled = canType,
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(if (photoMarked) MikuTeal.copy(alpha = 0.16f) else Color.Transparent)
                    .border(1.dp, if (photoMarked) MikuTeal.copy(alpha = 0.5f) else MikuOutline, CircleShape),
            ) {
                Icon(
                    MikuIcons.Image,
                    contentDescription = "Adjuntar foto",
                    tint = if (photoMarked) MikuTeal else MikuMuted,
                    modifier = Modifier.size(22.dp).alpha(if (canType) 1f else 0.4f),
                )
            }

            Box(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 44.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(MikuText.copy(alpha = 0.05f))
                    .border(1.dp, MikuOutline, RoundedCornerShape(22.dp))
                    .padding(horizontal = 16.dp, vertical = 11.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (inputText.isEmpty()) {
                    Text("Escríbele a Miku…", color = MikuDim, style = MikuTypography.bodyLarge)
                }
                BasicTextField(
                    value = inputText,
                    onValueChange = { inputText = it },
                    enabled = canType,
                    maxLines = 5,
                    textStyle = MikuTypography.bodyLarge.copy(color = MikuText),
                    cursorBrush = SolidColor(MikuTeal),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            IconButton(
                onClick = {
                    val text = inputText.trim()
                    inputText = ""
                    vm.sendMessage(text)
                },
                enabled = isSendEnabled,
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(if (isSendEnabled) MikuTeal else MikuMuted.copy(alpha = 0.14f)),
            ) {
                Icon(
                    MikuIcons.Send,
                    contentDescription = "Enviar",
                    tint = if (isSendEnabled) MikuOnTeal else Color(0xFF4E6866),
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }

}

private val MikuTypography = Typography

@Composable
private fun VoiceSeparator(timestampMs: Long?) {
    val time = timestampMs?.let { SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(it)) }
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.weight(1f).height(1.dp).background(MikuOutline))
        Icon(MikuIcons.Mic, contentDescription = null, tint = MikuDim, modifier = Modifier.size(14.dp))
        MikuLabelText(if (time != null) "POR VOZ · $time" else "POR VOZ", MikuDim, small = true)
        Box(Modifier.weight(1f).height(1.dp).background(MikuOutline))
    }
}

@Composable
private fun MessageBubble(msg: UiMessage, maxBubble: androidx.compose.ui.unit.Dp) {
    when (msg.role) {
        "miku" -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
            val shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 6.dp)
            Column(
                modifier = Modifier
                    .widthIn(max = maxBubble)
                    .clip(shape)
                    .background(MikuText.copy(alpha = 0.06f))
                    .border(1.dp, MikuTeal.copy(alpha = 0.24f), shape)
                    .padding(horizontal = 14.dp, vertical = 10.dp)
            ) {
                MikuLabelText("MIKU", MikuTeal, small = true)
                Spacer(Modifier.height(3.dp))
                Text(msg.text, color = MikuText, style = MikuTypography.bodyLarge)
            }
        }
        "user" -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            val shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 6.dp, bottomStart = 18.dp)
            // Lo dicho por voz: borde punteado, sin relleno.
            val bubble = if (msg.fromVoice) {
                Modifier.widthIn(max = maxBubble).dashedBorder(MikuPink.copy(alpha = 0.5f), 18.dp)
            } else {
                Modifier
                    .widthIn(max = maxBubble)
                    .clip(shape)
                    .background(MikuPink.copy(alpha = 0.14f))
                    .border(1.dp, MikuPink.copy(alpha = 0.32f), shape)
            }
            Column(
                modifier = bubble.padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalAlignment = Alignment.End,
            ) {
                if (msg.imageUri != null) {
                    AsyncImage(
                        model = msg.imageUri,
                        contentDescription = "Imagen enviada",
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 180.dp)
                            .clip(RoundedCornerShape(10.dp)),
                        contentScale = ContentScale.Crop,
                    )
                    Spacer(Modifier.height(6.dp))
                }
                Text(msg.text, color = MikuText, style = MikuTypography.bodyLarge)
            }
        }
        // Errores y avisos del sistema.
        else -> Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(MikuIcons.Alert, contentDescription = null, tint = MikuPinkText, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
            Text(msg.text, color = MikuPinkText, fontSize = 12.sp, textAlign = TextAlign.Center)
        }
    }
}

// "Escribiendo": tres puntos turquesa que parpadean escalonados (1,2 s) y,
// debajo, el rastro de tools del ciclo actual.
@Composable
private fun TypingBubble(tools: List<UiTool>, maxBubble: androidx.compose.ui.unit.Dp) {
    val transition = rememberInfiniteTransition(label = "typing")
    val shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 6.dp)
    Column(
        modifier = Modifier
            .widthIn(max = maxBubble)
            .clip(shape)
            .background(MikuText.copy(alpha = 0.06f))
            .border(1.dp, MikuTeal.copy(alpha = 0.24f), shape)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            repeat(3) { i ->
                val a by transition.animateFloat(
                    initialValue = 0.25f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(600, delayMillis = i * 200),
                        repeatMode = RepeatMode.Reverse,
                    ),
                    label = "dot$i",
                )
                Box(
                    Modifier
                        .size(7.dp)
                        .alpha(a)
                        .clip(CircleShape)
                        .background(MikuTeal)
                )
            }
        }
        tools.forEach { tool ->
            val (category, text) = describeTool(tool.name, tool.done)
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (tool.done) {
                    Box(
                        Modifier.size(20.dp).clip(CircleShape).background(MikuTeal.copy(alpha = 0.18f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(MikuIcons.Check, contentDescription = null, tint = MikuTeal, modifier = Modifier.size(12.dp))
                    }
                } else {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = MikuTeal,
                        trackColor = MikuTeal.copy(alpha = 0.25f),
                        strokeWidth = 2.dp,
                    )
                }
                Spacer(Modifier.width(8.dp))
                MikuLabelText(category, MikuDim, small = true, modifier = Modifier.width(78.dp))
                Text(text, color = MikuText, fontSize = 13.sp)
            }
        }
    }
}
