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
import com.sebas.mikuai.data.SecurePrefs
import com.sebas.mikuai.voice.ModelDownloadManager
import com.sebas.mikuai.voice.ModelDownloadState
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

// Hoja de configuración del chat. Sacada tal cual de ChatScreen.kt (ronda 2
// de diseño, fase A2); su rediseño es la fase A4.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    vm: ChatViewModel,
    onDismiss: () -> Unit,
    onLogout: () -> Unit,
) {
    val context = LocalContext.current
    val scope   = rememberCoroutineScope()
    var spotifyConnected by remember { mutableStateOf(vm.isSpotifyConnected()) }
    var spotifyConnecting by remember { mutableStateOf(false) }
    var spotifyError by remember { mutableStateOf<String?>(null) }
    var gmailAccounts by remember { mutableStateOf(vm.listConnectedGmailEmails()) }
    var gmailConnecting by remember { mutableStateOf(false) }
    var gmailError by remember { mutableStateOf<String?>(null) }
    var calendarAccounts by remember { mutableStateOf(vm.listConnectedCalendarEmails()) }
    var calendarConnecting by remember { mutableStateOf(false) }
    var calendarError by remember { mutableStateOf<String?>(null) }
    var wakeWordEnabled by remember { mutableStateOf(WakeWordPrefs.isEnabled(context)) }
    val securePrefs = remember { SecurePrefs(context) }
    var voiceMuted by remember { mutableStateOf(securePrefs.isVoiceMuted()) }
    val modelDownloadManager = remember { ModelDownloadManager(context) }

    val recordAudioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        wakeWordEnabled = granted
        WakeWordPrefs.setEnabled(context, granted)
        if (granted) WakeWordService.start(context)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor   = MikuSurface
    ) {
        // Idea #16: cada vez que se abre Configuración, si la voz real ya
        // está descargada, revisa contra el manifest.json remoto si hay
        // una versión nueva -- sin esto, Sebastián solo se enteraría de
        // un cambio del pipeline de voz recibiendo un APK nuevo a mano.
        LaunchedEffect(Unit) {
            modelDownloadManager.checkForUpdate()
        }
        Column(
            modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("⚙️ Configuración", color = MikuTeal, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text("v${com.sebas.mikuai.BuildConfig.VERSION_NAME}", color = MikuTextDim, fontSize = 10.sp)
            OutlinedButton(
                onClick = { onDismiss(); vm.reloadMemory() },
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

                // Camino PRINCIPAL para que la pantalla flotante de
                // "Hey Miku" aparezca al instante siempre (bloqueado o
                // no) -- ver wakeword/MikuOverlayWindow.kt. Sin este
                // permiso cae a una notificación de pantalla completa
                // que Android solo abre sola con el teléfono bloqueado
                // (con la pantalla desbloqueada y en uso, a propósito
                // se queda como notificación que hay que tocar --
                // política de la plataforma, confirmado con Sebastián
                // que así pasaba, no un bug de acá).
                var canDrawOverlays by remember {
                    mutableStateOf(Settings.canDrawOverlays(context))
                }
                if (!canDrawOverlays) {
                    OutlinedButton(
                        onClick = {
                            context.startActivity(
                                Intent(
                                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                    Uri.parse("package:${context.packageName}")
                                )
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuText)
                    ) { Text("🖼️ Habilitar que \"Hey Miku\" abra la pantalla sola") }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Voz de Miku", color = MikuTeal, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(if (voiceMuted) "Silenciada" else "Con voz", color = MikuTextDim, fontSize = 11.sp)
                    Switch(
                        checked = !voiceMuted,
                        onCheckedChange = { on ->
                            voiceMuted = !on
                            securePrefs.setVoiceMuted(voiceMuted)
                        },
                        colors = SwitchDefaults.colors(checkedThumbColor = MikuTeal, checkedTrackColor = MikuTealDark)
                    )
                }
            }
            val downloadState by modelDownloadManager.state.collectAsState()
            when (val s = downloadState) {
                is ModelDownloadState.Ready -> {
                    Text("Voz real descargada ✓ (~518MB)", color = MikuTeal, fontSize = 11.sp)
                }
                is ModelDownloadState.UpdateAvailable -> {
                    Text("Voz real descargada ✓ (~518MB)", color = MikuTeal, fontSize = 11.sp)
                    Text("Hay una versión nueva disponible.", color = MikuTextDim, fontSize = 11.sp)
                    OutlinedButton(
                        onClick = { scope.launch { modelDownloadManager.ensureModelsReady() } },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuText)
                    ) { Text("Actualizar voz de Miku") }
                }
                is ModelDownloadState.Downloading -> {
                    val pct = if (s.totalBytes > 0) (s.downloadedBytes * 100 / s.totalBytes).toInt() else 0
                    Text("Descargando ${s.fileName}... $pct%", color = MikuTextDim, fontSize = 11.sp)
                    LinearProgressIndicator(
                        progress = { if (s.totalBytes > 0) s.downloadedBytes.toFloat() / s.totalBytes else 0f },
                        modifier = Modifier.fillMaxWidth(),
                        color = MikuTeal,
                    )
                }
                is ModelDownloadState.Failed -> {
                    Text("Error descargando la voz real: ${s.message}", color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                    OutlinedButton(
                        onClick = { scope.launch { modelDownloadManager.ensureModelsReady() } },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuText)
                    ) { Text("Reintentar descarga") }
                }
                is ModelDownloadState.NotStarted -> {
                    OutlinedButton(
                        onClick = { scope.launch { modelDownloadManager.ensureModelsReady() } },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuText)
                    ) { Text("Descargar voz real de Miku (~518MB)") }
                    Text(
                        "Se usa una sola vez -- conviene hacerlo con Wi-Fi antes de viajar. Hasta que se descargue, responde con la voz del sistema.",
                        color = MikuTextDim,
                        fontSize = 11.sp
                    )
                }
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
            calendarAccounts.forEach { email ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(email, color = MikuText, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    IconButton(onClick = {
                        vm.disconnectCalendarAccount(email)
                        calendarAccounts = calendarAccounts.filter { it != email }
                    }) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "Desconectar cuenta de Calendar",
                            tint = MikuTextDim,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
            OutlinedButton(
                onClick = {
                    calendarConnecting = true
                    calendarError = null
                    vm.connectCalendar { email, error ->
                        calendarConnecting = false
                        if (email != null) {
                            calendarAccounts = calendarAccounts.filter { it != email } + email
                        } else {
                            calendarError = error
                        }
                    }
                },
                enabled = !calendarConnecting,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuText)
            ) {
                Text(
                    when {
                        calendarConnecting -> "Conectando..."
                        calendarAccounts.isEmpty() -> "Conectar Calendar"
                        else -> "+ Otra cuenta de Calendar"
                    }
                )
            }
            if (calendarError != null) {
                Text(calendarError.orEmpty(), color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
            }
            OutlinedButton(
                onClick = { onDismiss(); vm.logout(); onLogout() },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
            ) { Text("Borrar claves y cerrar sesión") }
            OutlinedButton(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MikuTextDim)
            ) { Text("Cerrar") }
        }
    }
}
