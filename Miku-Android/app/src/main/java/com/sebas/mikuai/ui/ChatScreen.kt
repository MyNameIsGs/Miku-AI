package com.sebas.mikuai.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.sebas.mikuai.wakeword.WakeWordPrefs
import com.sebas.mikuai.wakeword.WakeWordService
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import coil.compose.rememberAsyncImagePainter
import com.sebas.mikuai.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
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
    var spotifyConnected by remember { mutableStateOf(vm.isSpotifyConnected()) }
    var spotifyConnecting by remember { mutableStateOf(false) }
    var spotifyError by remember { mutableStateOf<String?>(null) }
    var gmailAccounts by remember { mutableStateOf(vm.listConnectedGmailEmails()) }
    var gmailConnecting by remember { mutableStateOf(false) }
    var gmailError by remember { mutableStateOf<String?>(null) }
    var wakeWordEnabled by remember { mutableStateOf(WakeWordPrefs.isEnabled(context)) }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        vm.selectImage(uri)
    }

    val recordAudioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        wakeWordEnabled = granted
        WakeWordPrefs.setEnabled(context, granted)
        if (granted) WakeWordService.start(context)
    }

    // Scroll al fondo cuando llega un mensaje nuevo o cambia el estado de carga
    LaunchedEffect(uiState.messages.size, uiState.isLoading) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MikuBg)
            .padding(WindowInsets.systemBars.asPaddingValues())
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MikuSurface)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment     = Alignment.CenterVertically
        ) {
            Column {
                Text("Hatsune Miku", color = MikuTeal, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Text(
                    text = uiState.statusText + (uiState.error?.let { " — $it" } ?: ""),
                    color = if (uiState.error != null) MaterialTheme.colorScheme.error else MikuTextDim,
                    fontSize = 11.sp
                )
            }
            IconButton(onClick = { showSettings = true }) {
                Icon(Icons.Default.Settings, contentDescription = "Configuración", tint = MikuTextDim)
            }
        }

        // Messages
        LazyColumn(
            state          = listState,
            modifier       = Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(uiState.messages) { msg ->
                MessageBubble(msg)
            }
            if (uiState.isLoading) {
                item { TypingIndicator() }
            }
        }

        // Preview de imagen seleccionada antes de enviar
        if (uiState.selectedImageUri != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MikuSurface)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(modifier = Modifier.size(60.dp)) {
                    Image(
                        painter = rememberAsyncImagePainter(uiState.selectedImageUri),
                        contentDescription = "Preview",
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop
                    )
                    IconButton(
                        onClick = { vm.selectImage(null) },
                        modifier = Modifier
                            .size(24.dp)
                            .align(Alignment.TopEnd)
                            .offset(x = 6.dp, y = (-6).dp)
                            .background(MaterialTheme.colorScheme.error, RoundedCornerShape(50))
                    ) {
                        Icon(
                            Icons.Default.Close, 
                            contentDescription = "Quitar", 
                            tint = MikuBg,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.width(12.dp))
                Text("Foto lista para enviar", color = MikuTextDim, fontSize = 12.sp)
            }
        }

        // Input Layout
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MikuSurface)
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .navigationBarsPadding()
                .imePadding(),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Botón de adjuntar foto
            IconButton(
                onClick = {
                    photoPickerLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                enabled = uiState.isReady && !uiState.isLoading,
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(50))
                    .background(MikuSurface2)
            ) {
                Icon(
                    Icons.Default.PhotoCamera, 
                    contentDescription = "Adjuntar Foto", 
                    tint = if (uiState.selectedImageUri != null) MikuTeal else MikuTextDim
                )
            }

            OutlinedTextField(
                value         = inputText,
                onValueChange = { inputText = it },
                modifier      = Modifier.weight(1f),
                placeholder   = { Text("Escríbele a Miku…", color = MikuTextDim) },
                enabled       = uiState.isReady && !uiState.isLoading,
                maxLines      = 5,
                colors        = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor   = MikuTeal,
                    unfocusedBorderColor = MikuBorder,
                    focusedTextColor     = MikuText,
                    unfocusedTextColor   = MikuText,
                    cursorColor          = MikuTeal
                ),
                shape = RoundedCornerShape(20.dp)
            )
            
            val isSendEnabled = uiState.isReady && !uiState.isLoading && (inputText.isNotBlank() || uiState.selectedImageUri != null)
            IconButton(
                onClick  = {
                    val text = inputText.trim()
                    inputText = ""
                    vm.sendMessage(text)
                    scope.launch {
                        listState.animateScrollToItem(
                            (uiState.messages.size).coerceAtLeast(0)
                        )
                    }
                },
                enabled  = isSendEnabled,
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(50))
                    .background(if (isSendEnabled) MikuTeal else MikuSurface2)
            ) {
                Icon(Icons.Default.Send, contentDescription = "Enviar",
                    tint = if (isSendEnabled) MikuBg else MikuTextDim)
            }
        }
    }

    // Settings bottom sheet
    if (showSettings) {
        ModalBottomSheet(
            onDismissRequest = { showSettings = false },
            containerColor   = MikuSurface
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("⚙️ Configuración", color = MikuTeal, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                OutlinedButton(
                    onClick = { showSettings = false; vm.reloadMemory() },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuText)
                ) { Text("↺ Recargar memoria desde GitHub") }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Decir \"Hey Miku\"", color = MikuText, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        Text(
                            "Escucha activa en segundo plano, como \"Hey Siri\". Usa el micrófono todo el tiempo y muestra una notificación permanente mientras está activo.",
                            color = MikuTextDim,
                            fontSize = 11.sp
                        )
                    }
                    Switch(
                        checked = wakeWordEnabled,
                        onCheckedChange = { checked ->
                            if (checked) {
                                val hasPermission = ContextCompat.checkSelfPermission(
                                    context, Manifest.permission.RECORD_AUDIO
                                ) == PackageManager.PERMISSION_GRANTED
                                if (hasPermission) {
                                    wakeWordEnabled = true
                                    WakeWordPrefs.setEnabled(context, true)
                                    WakeWordService.start(context)
                                } else {
                                    recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                }
                            } else {
                                wakeWordEnabled = false
                                WakeWordPrefs.setEnabled(context, false)
                                WakeWordService.stop(context)
                            }
                        },
                        colors = SwitchDefaults.colors(checkedThumbColor = MikuTeal, checkedTrackColor = MikuTealDark)
                    )
                }
                if (wakeWordEnabled) {
                    OutlinedButton(
                        onClick = {
                            val pm = context.getSystemService(PowerManager::class.java)
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                                pm?.isIgnoringBatteryOptimizations(context.packageName) != true
                            ) {
                                context.startActivity(
                                    Intent(
                                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                        Uri.parse("package:${context.packageName}")
                                    )
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuText)
                    ) { Text("🔋 Evitar que el sistema corte el micrófono en segundo plano") }
                }
                OutlinedButton(
                    onClick = {
                        spotifyConnecting = true
                        spotifyError = null
                        vm.connectSpotify { success, error ->
                            spotifyConnecting = false
                            if (success) spotifyConnected = true else spotifyError = error
                        }
                    },
                    enabled = !spotifyConnecting,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = if (spotifyConnected) MikuTeal else MikuText
                    )
                ) {
                    Text(
                        when {
                            spotifyConnecting -> "Conectando..."
                            spotifyConnected -> "Spotify conectado ✓"
                            else -> "Conectar Spotify"
                        }
                    )
                }
                if (spotifyError != null) {
                    Text(spotifyError.orEmpty(), color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                }
                gmailAccounts.forEach { email ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(email, color = MikuText, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        IconButton(onClick = {
                            vm.disconnectGmailAccount(email)
                            gmailAccounts = gmailAccounts.filter { it != email }
                        }) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Desconectar cuenta de Gmail",
                                tint = MikuTextDim,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
                OutlinedButton(
                    onClick = {
                        gmailConnecting = true
                        gmailError = null
                        vm.connectGmail { email, error ->
                            gmailConnecting = false
                            if (email != null) {
                                gmailAccounts = gmailAccounts.filter { it != email } + email
                            } else {
                                gmailError = error
                            }
                        }
                    },
                    enabled = !gmailConnecting,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuText)
                ) {
                    Text(
                        when {
                            gmailConnecting -> "Conectando..."
                            gmailAccounts.isEmpty() -> "Conectar Gmail"
                            else -> "+ Otra cuenta de Gmail"
                        }
                    )
                }
                if (gmailError != null) {
                    Text(gmailError.orEmpty(), color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                }
                OutlinedButton(
                    onClick = { showSettings = false; vm.logout(); onLogout() },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) { Text("Borrar claves y cerrar sesión") }
                OutlinedButton(
                    onClick = { showSettings = false },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuTextDim)
                ) { Text("Cerrar") }
            }
        }
    }
}

@Composable
private fun MessageBubble(msg: UiMessage) {
    when (msg.role) {
        "miku" -> Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Start
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = 300.dp)
                    .clip(RoundedCornerShape(14.dp, 14.dp, 14.dp, 4.dp))
                    .background(MikuSurface2)
                    .padding(horizontal = 14.dp, vertical = 10.dp)
            ) {
                Text("MIKU", color = MikuTeal, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(3.dp))
                Text(msg.text, color = MikuText, fontSize = 15.sp, lineHeight = 22.sp)
            }
        }
        "user" -> Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = 300.dp)
                    .clip(RoundedCornerShape(14.dp, 14.dp, 4.dp, 14.dp))
                    .background(MikuTealDark)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalAlignment = Alignment.End
            ) {
                if (msg.imageUri != null) {
                    AsyncImage(
                        model = msg.imageUri,
                        contentDescription = "Imagen enviada",
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 180.dp)
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop
                    )
                    Spacer(Modifier.height(6.dp))
                }
                Text(
                    text  = msg.text,
                    color = MikuBg,
                    fontSize = 15.sp,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
        else -> Text(
            text     = msg.text,
            color = MikuTextDim,
            fontSize = 12.sp,
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
    }
}

@Composable
private fun TypingIndicator() {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp, 14.dp, 14.dp, 4.dp))
            .background(MikuSurface2)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment     = Alignment.CenterVertically
    ) {
        repeat(3) { i ->
            val offset by animateFloatAsState(
                targetValue = 0f,
                animationSpec = androidx.compose.animation.core.infiniteRepeatable(
                    animation = androidx.compose.animation.core.keyframes {
                        durationMillis = 900
                        0f at 0
                        -6f at 200 + i * 100
                        0f at 400 + i * 100
                    }
                ),
                label = "dot$i"
            )
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .offset(y = offset.dp)
                    .clip(RoundedCornerShape(50))
                    .background(MikuTeal)
            )
        }
    }
}