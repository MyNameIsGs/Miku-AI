package com.sebas.mikuai.wakeword

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.sebas.mikuai.MainActivity
import com.sebas.mikuai.MikuApp
import com.sebas.mikuai.R
import com.sebas.mikuai.data.GmailApi
import com.sebas.mikuai.data.GmailAuth
import com.sebas.mikuai.data.GmailWatcher
import com.sebas.mikuai.data.MarkerParser
import com.sebas.mikuai.data.MikuRepository
import com.sebas.mikuai.data.Prompts
import com.sebas.mikuai.data.SecurePrefs
import com.sebas.mikuai.voice.AudioPlayer
import com.sebas.mikuai.voice.EdgeTtsClient
import com.sebas.mikuai.voice.Mp3Decoder
import com.sebas.mikuai.voice.ModelDownloadManager
import com.sebas.mikuai.voice.Resampler
import com.sebas.mikuai.voice.RvcPipeline
import com.sebas.mikuai.voice.StaticVoiceCache
import com.sebas.mikuai.voice.VoicePlaybackControl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Servicio en primer plano que escucha "Hey Miku" de forma continua en
 * Android — el equivalente al wake-word de desktop (Tarea 5.4 del plan),
 * pero usando el pipeline de audio del propio celular en vez del
 * micrófono de la PC.
 *
 * Flujo: AudioRecord (16kHz mono) → WakeWordEngine (mismo modelo
 * entrenado con nanowakeword que usa desktop, ver ese archivo) → al
 * detectar, se suelta el micrófono del wake-word, se muestra una pantalla
 * flotante estilo "Hey Gemini" (`MikuOverlayActivity`, vía notificación de
 * pantalla completa) y se usa el reconocimiento de voz nativo de Android
 * para capturar el pedido → se manda por el mismo ciclo de tool calling
 * que ya usa el chat de texto (MikuRepository.chatWithTools) → la
 * respuesta se lee en voz alta y el texto recién aparece en la pantalla
 * flotante cuando el audio ya está listo para sonar (no antes).
 *
 * A diferencia de desktop, acá NO hay STT propio (Whisper) -- usa el
 * reconocimiento de voz nativo del sistema. La voz SÍ es la real de Miku,
 * corrida on-device (ver `voice/RvcPipeline.kt`): Edge-TTS como fuente
 * (única dependencia de red, confirmado por A/B que suena mucho mejor que
 * un TTS offline) + HuBERT/RMVPE/generador RVC corriendo en el propio
 * teléfono via ONNX Runtime Mobile, sin PC ni LAN (se evaluó puentear la
 * voz real vía el servidor de voz de desktop -- descartado: dependía de
 * que la PC estuviera prendida y alcanzable, lo que no sirve de nada
 * viajando). Si los modelos todavía no se descargaron o cualquier paso
 * del pipeline falla, cae de vuelta al `TextToSpeech` del sistema --
 * nunca se queda muda.
 */
class WakeWordService : Service() {

    private lateinit var engine: WakeWordEngine
    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    @Volatile private var capturing = false

    private var speechRecognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false

    /** Solo se instancia si los 4 modelos ONNX ya están descargados -- evita cargar ~700MB de sesiones si la voz real nunca se usó. */
    private var rvcPipeline: RvcPipeline? = null

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var lastDetectionAt = 0L

    /** Ventana rodante de los últimos `CONFIRMATION_FRAMES` resultados (score>=THRESHOLD sí/no) -- ver `startCapture()`. */
    private val recentScores = ArrayDeque<Boolean>(CONFIRMATION_FRAMES)

    // Variante de la idea #8 propuesta por Sebastián en vivo: avisar de
    // correo nuevo apenas llega, en vez de que el loop idle lo mencione de
    // pasada. Ver GmailWatcher.kt.
    private lateinit var gmailWatcher: GmailWatcher

    override fun onCreate() {
        super.onCreate()
        startForegroundWithNotification(statusText(R.string.wakeword_status_listening))

        engine = WakeWordEngine(applicationContext)
        val prefs = SecurePrefs(applicationContext)
        gmailWatcher = GmailWatcher(GmailApi(GmailAuth(applicationContext, prefs)), prefs)
        scheduleGmailCheck()

        tts = TextToSpeech(applicationContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                tts?.language = Locale("es", "ES")
                VoicePlaybackControl.registerSystemTts(tts)
            }
        }

        if (SpeechRecognizer.isRecognitionAvailable(applicationContext)) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(applicationContext)
        }

        if (ModelDownloadManager(applicationContext).areModelsReady()) {
            rvcPipeline = try {
                RvcPipeline.create(applicationContext)
            } catch (e: Throwable) {
                // Throwable (no solo Exception): cargar ~518MB de sesiones ONNX
                // podría tirar OutOfMemoryError, que NO es una Exception.
                null // si falla cargar los modelos, speak() cae directo a TextToSpeech
            }
        }

        startCapture()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        mainHandler.removeCallbacks(gmailCheckRunnable)
        stopCapture()
        speechRecognizer?.destroy()
        VoicePlaybackControl.registerSystemTts(null)
        VoicePlaybackControl.registerStopCallback(null)
        tts?.shutdown()
        if (::engine.isInitialized) engine.close()
        rvcPipeline?.close()
        MikuOverlayWindow.hide(applicationContext) // evita "WindowLeaked" si el servicio muere con la ventana de overlay abierta
        MikuOverlayState.update(MikuOverlayPhase.Idle) // por si el servicio muere con la pantalla flotante abierta
        serviceScope.cancel()
        super.onDestroy()
    }

    // ---- Captura de audio + inferencia del wake-word ----

    private fun startCapture() {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO)
            != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            stopSelf()
            return
        }
        if (capturing) return

        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        val bufferSize = maxOf(minBuf, WakeWordEngine.FRAME_SAMPLES * 2 * 4)

        // MIC (no VOICE_RECOGNITION): en muchos teléfonos, VOICE_RECOGNITION
        // aplica control automático de ganancia (AGC) a nivel de plataforma
        // -- eso puede "normalizar" audio de fondo silencioso (música/video
        // de la compu) a un volumen artificialmente alto antes de que le
        // llegue al modelo. Desktop captura con `sounddevice` (crudo, sin
        // AGC) y el modelo se validó ahí -- MIC es la fuente más parecida
        // a esa captura cruda en Android (a diferencia de VOICE_RECOGNITION
        // o VOICE_COMMUNICATION, pensadas para aplicar su propio
        // procesamiento). Sospecha real detrás de por qué "Hey Miku" se
        // disparaba con audio genérico de la compu incluso a umbral 0.92.
        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )
        } catch (e: Exception) {
            null
        }

        if (record == null || record.state != AudioRecord.STATE_INITIALIZED) {
            record?.release()
            return
        }

        audioRecord = record
        capturing = true
        record.startRecording()

        recentScores.clear()
        captureThread = thread(name = "miku-wakeword-capture") {
            val chunk = ShortArray(WakeWordEngine.FRAME_SAMPLES)
            while (capturing) {
                val rec = audioRecord ?: break
                val read = rec.read(chunk, 0, chunk.size)
                if (read == chunk.size) {
                    val score = try {
                        engine.processChunk(chunk)
                    } catch (e: Exception) {
                        0f
                    }

                    // "confirmation frames": exigir que el score esté por
                    // encima del umbral en CONFIRMATION_FRAMES chunks
                    // CONSECUTIVOS (no uno solo) antes de disparar -- la
                    // misma técnica que usa openWakeWord (de donde deriva
                    // el modelo que portamos) para bajar falsos positivos:
                    // un "Hey Miku" real sostiene el score alto varios
                    // frames de 80ms seguidos, un pico de ruido de fondo
                    // (música/video) casi siempre dura uno solo. Reportado
                    // por Sebastián: seguía disparando con audio de la PC
                    // incluso a umbral 0.92 -- esto ataca el problema real
                    // (sostenido vs. pico aislado) en vez de subir el
                    // número a ciegas de nuevo.
                    recentScores.addLast(score >= THRESHOLD)
                    while (recentScores.size > CONFIRMATION_FRAMES) recentScores.removeFirst()

                    val confirmed = recentScores.size == CONFIRMATION_FRAMES && recentScores.all { it }
                    if (confirmed) {
                        val now = System.currentTimeMillis()
                        if (now - lastDetectionAt >= COOLDOWN_MS) {
                            lastDetectionAt = now
                            recentScores.clear()
                            engine.reset()
                            mainHandler.post { onWakeWordDetected() }
                        }
                    }
                }
            }
        }
    }

    private fun stopCapture() {
        // Orden importa: primero se corta capturing y se llama stop() para
        // desbloquear el read() que el hilo de captura puede tener
        // pendiente, DESPUÉS se espera a que ese hilo termine de verdad
        // (join), y solo entonces se libera el AudioRecord -- llamar a
        // release() mientras el otro hilo todavía podría estar adentro de
        // read() es una condición de carrera real, no solo teórica.
        capturing = false
        try {
            audioRecord?.stop()
        } catch (e: Exception) {
            // puede lanzar si ya estaba detenido -- no es un error real
        }
        captureThread?.join(500)
        captureThread = null
        audioRecord?.release()
        audioRecord = null
    }

    // ---- Reacción a la detección ----

    private fun onWakeWordDetected() {
        stopCapture() // soltamos el micrófono del wake-word antes de que lo tome el reconocedor de voz
        vibrateConfirm()
        updateNotification(statusText(R.string.wakeword_status_command))
        MikuOverlayState.update(MikuOverlayPhase.Listening)
        showOverlay()
        startSpeechRecognition()
    }

    /** Confirmación háptica corta al detectar "Hey Miku" -- mismo gesto que usan la mayoría de los asistentes de voz. */
    private fun vibrateConfirm() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            vibrator.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (e: Exception) {
            // sin vibrador, o sin permiso -- no es crítico, seguimos igual
        }
    }

    private fun startSpeechRecognition() {
        val recognizer = speechRecognizer
        if (recognizer == null) {
            speakAndReveal("", getString(R.string.wakeword_no_stt), cacheKey = "no_stt") // reactiva el mic sola cuando termine de hablar
            return
        }

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES")
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        }

        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle) {
                val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!text.isNullOrBlank()) {
                    MikuOverlayState.update(MikuOverlayPhase.Thinking)
                    handleVoiceCommand(text)
                } else {
                    MikuOverlayState.update(MikuOverlayPhase.Idle)
                    resumeWakeWordListening()
                }
            }

            override fun onError(error: Int) {
                MikuOverlayState.update(MikuOverlayPhase.Idle)
                resumeWakeWordListening()
            }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        try {
            recognizer.startListening(intent)
        } catch (e: Exception) {
            MikuOverlayState.update(MikuOverlayPhase.Idle)
            resumeWakeWordListening()
        }
    }

    private fun handleVoiceCommand(text: String) {
        updateNotification(statusText(R.string.wakeword_status_thinking))

        serviceScope.launch {
            try {
                val prefs = SecurePrefs(applicationContext)
                val gh = prefs.getGitHubToken()
                val or = prefs.getOpenRouterKey()
                if (gh == null || or == null) {
                    speakAndReveal(text, getString(R.string.wakeword_no_credentials), cacheKey = "no_credentials")
                    return@launch
                }

                val repo = MikuRepository(gh, or, applicationContext, prefs)
                val memory = repo.loadMemory()
                val activePendientes = repo.loadActivePendientes()
                val prompt = Prompts.buildVoicePrompt(memory, activePendientes)
                val raw = repo.chatWithTools(prompt, emptyList(), text)
                val parsed = MarkerParser.parse(raw)

                parsed.savePersonality.forEach { t ->
                    try { repo.appendToFile(memory, "personality", t) } catch (e: Exception) {}
                }
                parsed.saveMemories.forEach { t ->
                    try { repo.appendToFile(memory, "memories", t) } catch (e: Exception) {}
                }

                // Idea #10: guardar el intercambio para que ChatScreen lo
                // muestre la próxima vez que se abra la app -- fire-and-forget,
                // un fallo acá no debe interrumpir la respuesta por voz. Solo
                // se guardan intercambios reales (no las frases de error de
                // más abajo, que no aportan nada al historial).
                if (parsed.cleanText.isNotBlank()) {
                    serviceScope.launch {
                        try {
                            repo.appendVoiceHistory(text, parsed.cleanText)
                        } catch (e: Exception) {}
                    }
                }

                speakAndReveal(text, parsed.cleanText) // vacío es un no-op adentro, pero igual reactiva el mic al final
            } catch (e: Exception) {
                speakAndReveal(text, getString(R.string.wakeword_error), cacheKey = "error")
            }
        }
    }

    /**
     * Genera la voz de la respuesta y SOLO cuando el audio está listo
     * (o de inmediato, si la voz está silenciada) revela el texto en la
     * pantalla flotante ([MikuOverlayState]) -- a propósito, para que el
     * texto no "aparezca" antes que el audio esté por sonar (pedido de
     * Sebastián). Corre en su propio coroutine, SIN que el llamador lo
     * espere -- mismo comportamiento "fire and forget" de siempre.
     *
     * Importante: acá es donde se reactiva el micrófono del wake-word
     * (`resumeWakeWordListening()`), y SOLO una vez que el audio terminó
     * de sonar del todo -- no antes. Reactivarlo apenas se generaba el
     * audio (como hacía antes, en el `finally` de `handleVoiceCommand`)
     * dejaba el mic escuchando mientras la propia voz de Miku sonaba por
     * el parlante, y su propia respuesta a veces se parecía lo suficiente
     * a "Hey Miku" como para autoactivarse (bug real reportado por
     * Sebastián, no solo un tema de sensibilidad del modelo).
     *
     * Cualquier falla en cualquier paso del pipeline RVC cae al
     * `TextToSpeech` del sistema -- nunca se queda muda, y siempre termina
     * reactivando el mic por alguna de las ramas de abajo.
     *
     * [cacheKey] es no-nulo solo para las pocas frases ESTÁTICAS (avisos de
     * error, siempre el mismo texto) -- ver [StaticVoiceCache]. Las
     * respuestas reales del LLM (cacheKey null) nunca se cachean, son
     * distintas cada vez.
     */
    private fun speakAndReveal(heard: String, reply: String, cacheKey: String? = null) {
        if (reply.isBlank()) {
            MikuOverlayState.update(MikuOverlayPhase.Idle)
            resumeWakeWordListening()
            return
        }

        if (SecurePrefs(applicationContext).isVoiceMuted()) {
            // Sin audio que esperar -- se revela directo, y el mic se
            // reactiva con el mismo temporizador estimado que el TTS
            // (no hay nada sonando, pero mantiene un ritmo consistente
            // en vez de reactivar instantáneo).
            MikuOverlayState.update(MikuOverlayPhase.Responding(heard, reply))
            scheduleOverlayDismissAndResume(reply)
            return
        }

        val pipeline = rvcPipeline
        if (pipeline != null) {
            serviceScope.launch {
                try {
                    val mikuVoice = withContext(Dispatchers.IO) {
                        val cached = cacheKey?.let { StaticVoiceCache.load(applicationContext, it, reply) }
                        if (cached != null) {
                            cached
                        } else {
                            val mp3 = EdgeTtsClient.synthesize(reply)
                            val decoded = Mp3Decoder.decode(mp3)
                            val source16k = Resampler.resample(decoded.samples, decoded.sampleRate, 16000)
                            val generated = pipeline.convert(source16k)
                            if (cacheKey != null) {
                                StaticVoiceCache.save(applicationContext, cacheKey, reply, generated)
                            }
                            generated
                        }
                    }
                    // Audio listo -- recién ahora se "manda" el mensaje.
                    MikuOverlayState.update(MikuOverlayPhase.Responding(heard, reply))
                    withContext(Dispatchers.IO) { AudioPlayer.play(mikuVoice, 48000) }
                    // El audio YA terminó de sonar -- recién acá es seguro reactivar el mic.
                    MikuOverlayState.update(MikuOverlayPhase.Idle)
                    resumeWakeWordListening()
                } catch (e: Exception) {
                    speakSystemTtsAndReveal(heard, reply)
                }
            }
            return
        }

        speakSystemTtsAndReveal(heard, reply)
    }

    /** Camino de respaldo (sin RVC, o si falló): el TTS del sistema no tiene un "archivo" que esperar, así que se revela de inmediato. */
    private fun speakSystemTtsAndReveal(heard: String, reply: String) {
        MikuOverlayState.update(MikuOverlayPhase.Responding(heard, reply))
        if (ttsReady) {
            tts?.speak(reply, TextToSpeech.QUEUE_FLUSH, null, "miku_voice_reply")
        }
        scheduleOverlayDismissAndResume(reply)
    }

    /**
     * El TTS del sistema no avisa cuándo termina de hablar -- se estima por
     * longitud del texto (~16 caracteres/seg) para cerrar la pantalla
     * flotante Y reactivar el mic del wake-word recién ahí (mismo motivo
     * que en el camino RVC: no reactivarlo mientras todavía podría estar
     * sonando la voz).
     */
    private fun scheduleOverlayDismissAndResume(reply: String) {
        val estimatedMs = (reply.length * 60L) + 1200L
        val resumeRunnable = Runnable {
            VoicePlaybackControl.registerStopCallback(null)
            MikuOverlayState.update(MikuOverlayPhase.Idle)
            resumeWakeWordListening()
        }
        // Si se pide cortar el audio (botón de cerrar de la pantalla
        // flotante) antes de que se cumpla el tiempo estimado, no hace
        // falta esperarlo -- se adelanta el mismo resumeRunnable ya
        // armado, en vez de duplicar su lógica.
        VoicePlaybackControl.registerStopCallback {
            mainHandler.removeCallbacks(resumeRunnable)
            mainHandler.post(resumeRunnable)
        }
        mainHandler.postDelayed(resumeRunnable, estimatedMs)
    }

    private fun resumeWakeWordListening() {
        updateNotification(statusText(R.string.wakeword_status_listening))
        startCapture()
    }

    /**
     * Chequeo periódico de correo nuevo (ver GmailWatcher.kt) -- se
     * reprograma a sí mismo cada [GMAIL_CHECK_INTERVAL_MS], mientras el
     * servicio esté vivo. Solo corre si el wake-word está realmente
     * escuchando en este momento ([capturing], fase Idle) -- si hay una
     * conversación en curso, se saltea este turno y se reintenta en el
     * próximo (no hay cola de audio acá como en desktop, así que evitar la
     * superposición es más simple que resolverla).
     *
     * Antes de anunciar, corta la captura del wake-word con `stopCapture()`
     * -- mismo motivo que `onWakeWordDetected()`: el mic no debe quedar
     * escuchando mientras Miku habla (bug real ya resuelto una vez en el
     * Paso 5, no repetirlo acá). `speakAndReveal` ya se encarga de
     * reactivarlo solo cuando el audio termina.
     */
    // Runnable con nombre (no una lambda anónima nueva en cada postDelayed)
    // para poder cancelarlo en onDestroy() -- si no, el Handler del
    // Looper principal (no atado al ciclo de vida del Service) seguiría
    // reprogramándose solo para siempre, reteniendo esta instancia viva.
    private val gmailCheckRunnable = object : Runnable {
        override fun run() {
            if (capturing && MikuOverlayState.phase.value is MikuOverlayPhase.Idle) {
                serviceScope.launch {
                    try {
                        val announcement = gmailWatcher.checkForNewMail()
                        if (!announcement.isNullOrBlank()) {
                            stopCapture()
                            speakAndReveal("", announcement)
                        }
                    } catch (e: Exception) {
                        // Sin Gmail conectado, o un error de red puntual --
                        // se reintenta solo en el próximo chequeo.
                    }
                }
            }
            mainHandler.postDelayed(this, GMAIL_CHECK_INTERVAL_MS)
        }
    }

    private fun scheduleGmailCheck() {
        mainHandler.postDelayed(gmailCheckRunnable, GMAIL_CHECK_INTERVAL_MS)
    }

    // ---- Notificaciones ----

    private fun startForegroundWithNotification(text: String) {
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                FOREGROUND_NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(FOREGROUND_NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(FOREGROUND_NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(applicationContext, MikuApp.WAKEWORD_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Miku")
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    /**
     * Muestra la pantalla flotante estilo "Hey Gemini". Camino principal:
     * `MikuOverlayWindow` (ventana de overlay de verdad, aparece al
     * instante, requiere el permiso "Mostrar sobre otras apps"). Si ese
     * permiso no está dado, cae a lanzar `MikuOverlayActivity` vía
     * notificación de pantalla completa -- que Android solo abre sola con
     * el teléfono bloqueado (con la pantalla desbloqueada y en uso se
     * queda como notificación normal que hay que tocar, a propósito,
     * política de la plataforma contra "publicidad a pantalla completa",
     * confirmado -- no hay forma de saltarlo sin el permiso de arriba).
     */
    private fun showOverlay() {
        if (MikuOverlayWindow.isPermissionGranted(applicationContext)) {
            MikuOverlayWindow.show(applicationContext)
            return
        }

        val intent = Intent(applicationContext, MikuOverlayActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 2, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(applicationContext, MikuApp.OVERLAY_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Miku")
            .setContentText(statusText(R.string.wakeword_status_command))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(pendingIntent, true)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(OVERLAY_NOTIFICATION_ID, notification)
    }

    private fun statusText(resId: Int): String = getString(resId)

    companion object {
        private const val SAMPLE_RATE = 16000
        // 0.92 (no 0.85, el valor de desktop): Sebastián reportó falsos
        // positivos reales en el teléfono con frases/sonidos sin relación
        // -- el mismo umbral que en desktop resultó demasiado permisivo acá,
        // probablemente por diferencias de micrófono/ganancia. Ajustar de
        // nuevo si hace falta (más alto = menos falsos positivos, pero más
        // riesgo de que "Hey Miku" real no dispare a la primera).
        private const val THRESHOLD = 0.92f
        // 3 frames consecutivos de 80ms (=240ms) por encima del umbral --
        // mismo valor por default que usa openWakeWord (la librería de la
        // que deriva nanowakeword/nuestro modelo) para exactamente este
        // problema. Ver el comentario largo en `startCapture()`.
        private const val CONFIRMATION_FRAMES = 3
        private const val COOLDOWN_MS = 3000L
        // Cada cuánto revisar si llegó correo nuevo -- balance entre "se
        // entera pronto" y no ametrallar la API de Gmail / batería con el
        // servicio corriendo todo el día. Fácil de ajustar si en el uso
        // real se siente muy lento o muy seguido.
        private const val GMAIL_CHECK_INTERVAL_MS = 5 * 60_000L
        const val FOREGROUND_NOTIFICATION_ID = 4200
        const val OVERLAY_NOTIFICATION_ID = 4201

        fun start(context: Context) {
            val intent = Intent(context, WakeWordService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, WakeWordService::class.java))
        }
    }
}
