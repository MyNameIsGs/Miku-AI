package com.sebas.mikuai.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.sebas.mikuai.BuildConfig
import com.sebas.mikuai.data.MiUbicacion
import com.sebas.mikuai.data.SecurePrefs
import com.sebas.mikuai.ui.theme.*
import com.sebas.mikuai.voice.ModelDownloadManager
import com.sebas.mikuai.voice.ModelDownloadState
import com.sebas.mikuai.wakeword.WakeWordPrefs
import com.sebas.mikuai.wakeword.WakeWordService
import kotlinx.coroutines.launch

// Configuración de Android, ronda 2 de diseño (docs/diseno-ui-v2/DISENO.md
// §6.4): pantalla propia con botón atrás (antes era una hoja) y secciones
// numeradas. La lógica de cada opción es la de siempre.
@Composable
fun SettingsScreen(
    vm: ChatViewModel,
    onBack: () -> Unit,
    onLogout: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
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
    // Lista de cuentas abierta (Gmail o Calendar), como subpantalla.
    var accountsOf by remember { mutableStateOf<String?>(null) }

    // Permisos que se dan en Ajustes de Android: se vuelven a leer al volver.
    var canDrawOverlays by remember { mutableStateOf(Settings.canDrawOverlays(context)) }
    var batteryOk by remember { mutableStateOf(isIgnoringBatteryOptimizations(context)) }
    val activity = context as? ComponentActivity
    DisposableEffect(activity) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                canDrawOverlays = Settings.canDrawOverlays(context)
                batteryOk = isIgnoringBatteryOptimizations(context)
            }
        }
        activity?.lifecycle?.addObserver(observer)
        onDispose { activity?.lifecycle?.removeObserver(observer) }
    }

    // Google Maps, paso 2: permiso para la tool mi_ubicacion.
    var hasLocation by remember { mutableStateOf(MiUbicacion.hasPermission(context)) }
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) {
        hasLocation = MiUbicacion.hasPermission(context)
        // El servicio de "Hey Miku" toma el tipo ubicación al arrancar:
        // se reinicia para que mi_ubicacion funcione también por voz.
        if (hasLocation && WakeWordPrefs.isEnabled(context)) {
            WakeWordService.stop(context)
            WakeWordService.start(context)
        }
    }

    val recordAudioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        wakeWordEnabled = granted
        WakeWordPrefs.setEnabled(context, granted)
        if (granted) WakeWordService.start(context)
    }

    // Idea #16: cada vez que se abre Configuración, si la voz real ya está
    // descargada, revisa contra el manifest.json remoto si hay una versión
    // nueva -- sin esto, Sebastián solo se enteraría de un cambio del
    // pipeline de voz recibiendo un APK nuevo a mano.
    LaunchedEffect(Unit) {
        modelDownloadManager.checkForUpdate()
    }

    BackHandler { if (accountsOf != null) accountsOf = null else onBack() }

    val connectGmail = {
        gmailConnecting = true
        gmailError = null
        vm.connectGmail { email, error ->
            gmailConnecting = false
            if (email != null) gmailAccounts = gmailAccounts.filter { it != email } + email else gmailError = error
        }
    }
    val connectCalendar = {
        calendarConnecting = true
        calendarError = null
        vm.connectCalendar { email, error ->
            calendarConnecting = false
            if (email != null) calendarAccounts = calendarAccounts.filter { it != email } + email else calendarError = error
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MikuBg)
            .padding(WindowInsets.statusBars.asPaddingValues())
    ) {
        // Cabecera con botón atrás.
        Row(
            modifier = Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = { if (accountsOf != null) accountsOf = null else onBack() },
                modifier = Modifier.size(44.dp),
            ) {
                Icon(MikuIcons.Back, contentDescription = "Volver", tint = MikuText, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(6.dp))
            Text(
                text = when (accountsOf) {
                    "gmail" -> "Cuentas de Gmail"
                    "calendar" -> "Cuentas de Calendar"
                    else -> "Configuración"
                },
                style = Typography.titleLarge,
                color = MikuText,
            )
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (accountsOf != null) {
                val isGmail = accountsOf == "gmail"
                AccountsCard(
                    accounts = if (isGmail) gmailAccounts else calendarAccounts,
                    connecting = if (isGmail) gmailConnecting else calendarConnecting,
                    error = if (isGmail) gmailError else calendarError,
                    onRemove = { email ->
                        if (isGmail) {
                            vm.disconnectGmailAccount(email)
                            gmailAccounts = gmailAccounts.filter { it != email }
                        } else {
                            vm.disconnectCalendarAccount(email)
                            calendarAccounts = calendarAccounts.filter { it != email }
                        }
                    },
                    onAdd = if (isGmail) connectGmail else connectCalendar,
                )
                return@Column
            }

            Section("01", "HEY MIKU") {
                SettingRow(
                    title = "Decir «Hey Miku»",
                    subtitle = "Escucha en segundo plano. Usa el micrófono todo el tiempo y deja una notificación mientras está activo.",
                ) {
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
                        colors = mikuSwitchColors(),
                    )
                }
                if (wakeWordEnabled) {
                    Divider()
                    // Camino principal para que la pantalla flotante aparezca
                    // al instante siempre (bloqueado o no), ver
                    // wakeword/MikuOverlayWindow.kt. Sin este permiso cae a una
                    // notificación de pantalla completa que Android solo abre
                    // sola con el teléfono bloqueado.
                    SettingRow(
                        title = "Mostrarse sobre otras apps",
                        subtitle = "Para que la ventana flotante aparezca sola.",
                        icon = MikuIcons.Layers,
                    ) {
                        if (canDrawOverlays) {
                            DoneTag()
                        } else {
                            PillButton("Permitir", accent = true) {
                                context.startActivity(
                                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
                                )
                            }
                        }
                    }
                    Divider()
                    SettingRow(
                        title = "Que no le corten el micrófono",
                        subtitle = if (batteryOk) "Android no la frena en segundo plano." else "El ahorro de batería puede cortar «Hey Miku».",
                        icon = MikuIcons.Battery,
                        warn = !batteryOk,
                    ) {
                        if (batteryOk) {
                            DoneTag()
                        } else {
                            PillButton("Permitir", accent = true) {
                                context.startActivity(
                                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
                                )
                            }
                        }
                    }
                }
            }

            Section("02", "VOZ REAL DE MIKU") {
                SettingRow(
                    title = "Voz de Miku",
                    subtitle = if (voiceMuted) "Silenciada: responde solo con texto." else "Con voz.",
                ) {
                    Switch(
                        checked = !voiceMuted,
                        onCheckedChange = { on ->
                            voiceMuted = !on
                            securePrefs.setVoiceMuted(voiceMuted)
                        },
                        colors = mikuSwitchColors(),
                    )
                }
                Divider()
                val downloadState by modelDownloadManager.state.collectAsState()
                VoiceCard(downloadState) { scope.launch { modelDownloadManager.ensureModelsReady() } }
            }

            Section("03", "CONEXIONES") {
                ConnectionRow(
                    name = "Spotify",
                    status = when {
                        spotifyConnecting -> "Conectando…"
                        spotifyConnected -> "Conectado"
                        else -> "Sin conectar"
                    },
                    ok = spotifyConnected,
                    error = spotifyError,
                ) {
                    PillButton(if (spotifyConnected) "Reconectar" else "Conectar", accent = !spotifyConnected, enabled = !spotifyConnecting) {
                        spotifyConnecting = true
                        spotifyError = null
                        vm.connectSpotify { success, error ->
                            spotifyConnecting = false
                            if (success) spotifyConnected = true else spotifyError = error
                        }
                    }
                }
                Divider()
                AccountsRow("Gmail", gmailAccounts, gmailConnecting, gmailError, onConnect = connectGmail) { accountsOf = "gmail" }
                Divider()
                AccountsRow("Google Calendar", calendarAccounts, calendarConnecting, calendarError, onConnect = connectCalendar) {
                    accountsOf = "calendar"
                }
                Divider()
                SettingRow(
                    title = "Ubicación",
                    subtitle = if (hasLocation) "Miku puede saber dónde estás cuando se lo pides." else "Para «¿dónde estoy?» y las rutas desde donde estás.",
                    icon = MikuIcons.Pin,
                ) {
                    if (hasLocation) {
                        DoneTag()
                    } else {
                        PillButton("Permitir", accent = true) {
                            locationPermissionLauncher.launch(
                                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                            )
                        }
                    }
                }
            }

            Section("04", "MEMORIA") {
                SettingRow(
                    title = "Recargar memoria",
                    subtitle = "Vuelve a leer su memoria desde GitHub.",
                    icon = MikuIcons.Reload,
                ) {
                    PillButton("Recargar") {
                        vm.reloadMemory()
                        onBack()
                    }
                }
            }

            Section("05", "CUENTA") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .clickable { vm.logout(); onLogout() }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(MikuIcons.Logout, contentDescription = null, tint = MikuPinkText, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(12.dp))
                    Text("Borrar claves y cerrar sesión", color = MikuPinkText, fontFamily = ZenKaku, fontWeight = FontWeight.Medium, fontSize = 15.sp)
                }
            }

            MikuLabelText(
                "MIKU-AI · VERSIÓN ${BuildConfig.VERSION_NAME}",
                MikuDim,
                small = true,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 6.dp),
            )
        }
    }
}

private fun isIgnoringBatteryOptimizations(context: android.content.Context): Boolean =
    context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true

@Composable
private fun mikuSwitchColors() = SwitchDefaults.colors(
    checkedThumbColor = MikuOnTeal,
    checkedTrackColor = MikuTeal,
    checkedBorderColor = MikuTeal,
    uncheckedThumbColor = MikuMuted,
    uncheckedTrackColor = MikuMuted.copy(alpha = 0.25f),
    uncheckedBorderColor = Color.Transparent,
)

@Composable
private fun Section(number: String, title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(MikuCard)
            .border(1.dp, MikuCardBorder, RoundedCornerShape(18.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(Modifier.padding(bottom = 6.dp)) {
            MikuLabelText(number, MikuPink)
            Spacer(Modifier.width(8.dp))
            MikuLabelText(title, MikuTeal)
        }
        content()
    }
}

@Composable
private fun Divider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(MikuMuted.copy(alpha = 0.12f)))
}

@Composable
private fun SettingRow(
    title: String,
    subtitle: String? = null,
    icon: ImageVector? = null,
    warn: Boolean = false,
    action: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = if (warn) MikuPinkText else MikuMuted, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f).padding(end = 10.dp)) {
            Text(title, color = if (warn) MikuPinkText else MikuText, fontFamily = ZenKaku, fontWeight = FontWeight.Medium, fontSize = 15.sp)
            if (subtitle != null) {
                Text(subtitle, color = MikuMuted, fontFamily = ZenKaku, fontSize = 12.sp, lineHeight = 17.sp)
            }
        }
        action()
    }
}

@Composable
private fun DoneTag() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(MikuIcons.Check, contentDescription = null, tint = MikuTeal, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(4.dp))
        Text("Listo", color = MikuTeal, fontFamily = ZenKaku, fontWeight = FontWeight.Medium, fontSize = 14.sp)
    }
}

@Composable
private fun PillButton(label: String, accent: Boolean = false, enabled: Boolean = true, filled: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    Box(
        modifier = Modifier
            .heightIn(min = 44.dp)
            .clip(shape)
            .background(if (filled) MikuTeal else Color.Transparent)
            .border(1.dp, if (filled) MikuTeal else if (accent) MikuTeal.copy(alpha = 0.5f) else MikuOutline, shape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = when {
                !enabled -> MikuDim
                filled -> MikuOnTeal
                accent -> MikuTeal
                else -> MikuText
            },
            fontFamily = ZenKaku,
            fontWeight = if (filled) FontWeight.Bold else FontWeight.Medium,
            fontSize = 14.sp,
        )
    }
}

@Composable
private fun StatusLine(text: String, ok: Boolean, error: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(if (error) MikuPink else if (ok) MikuTeal else Color.Transparent)
                .border(1.dp, if (error) MikuPink else if (ok) MikuTeal else MikuDim, CircleShape)
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text,
            color = if (error) MikuPinkText else MikuMuted,
            fontFamily = ZenKaku,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// Motivo legible de un error de conexión (igual que en el escritorio).
private fun connectionErrorText(raw: String): String = when {
    Regex("invalid_grant|expired|revoked|vencid", RegexOption.IGNORE_CASE).containsMatchIn(raw) ->
        "Sesión vencida: Google la corta cada 7 días en modo prueba."
    Regex("cancel|closed|cerr|denied", RegexOption.IGNORE_CASE).containsMatchIn(raw) ->
        "No se pudo conectar: se cerró la ventana antes de terminar."
    else -> "No se pudo conectar: ${raw.take(80)}"
}

@Composable
private fun ConnectionRow(name: String, status: String, ok: Boolean, error: String?, action: @Composable () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(name, color = MikuText, fontFamily = ZenKaku, fontWeight = FontWeight.Medium, fontSize = 15.sp)
            if (error != null) StatusLine(connectionErrorText(error), ok = false, error = true) else StatusLine(status, ok)
        }
        action()
    }
}

@Composable
private fun AccountsRow(
    name: String,
    accounts: List<String>,
    connecting: Boolean,
    error: String?,
    onConnect: () -> Unit,
    onOpen: () -> Unit,
) {
    val status = when {
        connecting -> "Conectando…"
        accounts.isEmpty() -> "Sin conectar"
        accounts.size == 1 -> "1 cuenta"
        else -> "${accounts.size} cuentas"
    }
    if (accounts.isEmpty()) {
        ConnectionRow(name, status, ok = false, error = error) {
            PillButton(if (error != null) "Reintentar" else "Conectar", accent = true, enabled = !connecting, onClick = onConnect)
        }
    } else {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .clickable(onClick = onOpen),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                ConnectionRow(name, status, ok = true, error = error) {}
            }
            Icon(MikuIcons.ChevronRight, contentDescription = "Ver cuentas de $name", tint = MikuMuted, modifier = Modifier.size(22.dp))
        }
    }
}

@Composable
private fun AccountsCard(
    accounts: List<String>,
    connecting: Boolean,
    error: String?,
    onRemove: (String) -> Unit,
    onAdd: () -> Unit,
) {
    Section("", "CUENTAS CONECTADAS") {
        accounts.forEachIndexed { i, email ->
            if (i > 0) Divider()
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    email,
                    color = MikuText,
                    fontFamily = ZenKaku,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { onRemove(email) }, modifier = Modifier.size(44.dp)) {
                    Icon(MikuIcons.Close, contentDescription = "Quitar $email", tint = MikuMuted, modifier = Modifier.size(18.dp))
                }
            }
        }
        if (error != null) StatusLine(connectionErrorText(error), ok = false, error = true)
        Spacer(Modifier.height(6.dp))
        PillButton(if (connecting) "Conectando…" else "Agregar otra cuenta", accent = true, enabled = !connecting, onClick = onAdd)
    }
}

// Tarjeta de la voz real (4 estados): sin descargar, descargando (la tira
// de teclas como progreso), falló y lista (con «Actualizar» si hay nueva).
@Composable
private fun VoiceCard(state: ModelDownloadState, onDownload: () -> Unit) {
    val failed = state is ModelDownloadState.Failed
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (failed) MikuPink.copy(alpha = 0.06f) else MikuText.copy(alpha = 0.03f))
            .border(1.dp, if (failed) MikuPink.copy(alpha = 0.35f) else MikuCardBorder, RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        when (state) {
            is ModelDownloadState.NotStarted -> {
                Text("Su voz de verdad", color = MikuText, fontFamily = ZenKaku, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(
                    "Se descarga una sola vez (518 MB): conviene hacerlo con Wi-Fi. Mientras tanto responde con la voz del sistema.",
                    color = MikuMuted, fontFamily = ZenKaku, fontSize = 12.sp, lineHeight = 17.sp,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PillButton("Descargar", filled = true, onClick = onDownload)
                    Spacer(Modifier.width(10.dp))
                    MikuLabelText("518 MB", MikuDim, small = true)
                }
            }
            is ModelDownloadState.Downloading -> {
                val fraction = if (state.totalBytes > 0) state.downloadedBytes.toFloat() / state.totalBytes else 0f
                Text("Descargando su voz…", color = MikuText, fontFamily = ZenKaku, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                KeysProgress(fraction, keys = 28)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    MikuLabelText(
                        "${state.downloadedBytes / 1_000_000} DE ${state.totalBytes / 1_000_000} MB",
                        MikuMuted,
                        small = true,
                    )
                    MikuLabelText("${(fraction * 100).toInt()}%", MikuText)
                }
            }
            is ModelDownloadState.Failed -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(MikuIcons.Alert, contentDescription = null, tint = MikuPinkText, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Se cortó la descarga", color = MikuPinkText, fontFamily = ZenKaku, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                }
                Text(state.message, color = MikuMuted, fontFamily = ZenKaku, fontSize = 12.sp, lineHeight = 17.sp, maxLines = 3)
                PillButton("Reintentar", accent = true, onClick = onDownload)
            }
            is ModelDownloadState.Ready, is ModelDownloadState.UpdateAvailable -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(24.dp).clip(CircleShape).background(MikuTeal.copy(alpha = 0.18f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(MikuIcons.Check, contentDescription = null, tint = MikuTeal, modifier = Modifier.size(14.dp))
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Su voz está lista", color = MikuText, fontFamily = ZenKaku, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        if (state is ModelDownloadState.UpdateAvailable) {
                            Text("Hay una versión nueva.", color = MikuMuted, fontFamily = ZenKaku, fontSize = 12.sp)
                        }
                    }
                    if (state is ModelDownloadState.UpdateAvailable) {
                        PillButton("Actualizar", accent = true, onClick = onDownload)
                    }
                }
            }
        }
    }
}

/** La tira de teclas de piano como barra de progreso (mismo patrón que el
 *  escritorio: blanca, negra, blanca, negra, blanca, blanca…). */
@Composable
fun KeysProgress(fraction: Float, keys: Int) {
    val octave = booleanArrayOf(false, true, false, true, false, false, true, false, true, false, true, false)
    val lit = (fraction.coerceIn(0f, 1f) * keys).toInt()
    Row(
        modifier = Modifier.fillMaxWidth().height(14.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        for (i in 0 until keys) {
            val black = octave[i % 12]
            Box(
                Modifier
                    .weight(1f)
                    .height(if (black) 9.dp else 14.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(
                        when {
                            i < lit && black -> MikuTealDim
                            i < lit -> MikuTeal
                            black -> MikuMuted.copy(alpha = 0.22f)
                            else -> MikuText.copy(alpha = 0.12f)
                        }
                    )
            )
        }
    }
}
