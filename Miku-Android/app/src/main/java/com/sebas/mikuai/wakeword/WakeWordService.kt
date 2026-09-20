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
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.sebas.mikuai.MainActivity
import com.sebas.mikuai.MikuApp
import com.sebas.mikuai.R
import com.sebas.mikuai.data.MarkerParser
import com.sebas.mikuai.data.MikuRepository
import com.sebas.mikuai.data.Prompts
import com.sebas.mikuai.data.SecurePrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
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
 * detectar, se suelta el micrófono del wake-word y se usa el
 * reconocimiento de voz nativo de Android para capturar el pedido → se
 * manda por el mismo ciclo de tool calling que ya usa el chat de texto
 * (MikuRepository.chatWithTools) → la respuesta se lee en voz alta con
 * TextToSpeech del sistema y además se muestra como notificación (por si
 * no se escuchó, o la pantalla estaba apagada).
 *
 * A diferencia de desktop, acá NO hay STT propio (Whisper) ni voz propia
 * (RVC) — usa lo que ya trae el sistema operativo. Es una decisión de
 * plataforma, no un recorte de alcance: instalar y correr Whisper/RVC en
 * un teléfono no tiene el mismo sentido que en una PC con GPU dedicada.
 * (Se evaluó puentear la voz real vía el servidor de voz de desktop por
 * la red local -- descartado: dependía de que la PC estuviera prendida y
 * alcanzable, lo que no sirve de nada viajando. La voz real en Android
 * queda pendiente de un port on-device del propio RVC, ver el plan.)
 */
class WakeWordService : Service() {

    private lateinit var engine: WakeWordEngine
    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    @Volatile private var capturing = false

    private var speechRecognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var lastDetectionAt = 0L

    override fun onCreate() {
        super.onCreate()
        startForegroundWithNotification(statusText(R.string.wakeword_status_listening))

        engine = WakeWordEngine(applicationContext)

        tts = TextToSpeech(applicationContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                tts?.language = Locale("es", "ES")
            }
        }

        if (SpeechRecognizer.isRecognitionAvailable(applicationContext)) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(applicationContext)
        }

        startCapture()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopCapture()
        speechRecognizer?.destroy()
        tts?.shutdown()
        if (::engine.isInitialized) engine.close()
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

        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
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
                    if (score >= THRESHOLD) {
                        val now = System.currentTimeMillis()
                        if (now - lastDetectionAt >= COOLDOWN_MS) {
                            lastDetectionAt = now
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
        updateNotification(statusText(R.string.wakeword_status_command))
        startSpeechRecognition()
    }

    private fun startSpeechRecognition() {
        val recognizer = speechRecognizer
        if (recognizer == null) {
            speak(getString(R.string.wakeword_no_stt))
            resumeWakeWordListening()
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
                    handleVoiceCommand(text)
                } else {
                    resumeWakeWordListening()
                }
            }

            override fun onError(error: Int) = resumeWakeWordListening()
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
                    speak(getString(R.string.wakeword_no_credentials))
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

                if (parsed.cleanText.isNotBlank()) {
                    speak(parsed.cleanText)
                    showReplyNotification(text, parsed.cleanText)
                }
            } catch (e: Exception) {
                speak(getString(R.string.wakeword_error))
            } finally {
                resumeWakeWordListening()
            }
        }
    }

    private fun speak(text: String) {
        if (text.isBlank() || !ttsReady) return
        if (SecurePrefs(applicationContext).isVoiceMuted()) return
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "miku_voice_reply")
    }

    private fun resumeWakeWordListening() {
        updateNotification(statusText(R.string.wakeword_status_listening))
        startCapture()
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

    private fun showReplyNotification(heard: String, reply: String) {
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 1, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(applicationContext, MikuApp.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Miku")
            .setContentText(reply.take(80))
            .setStyle(NotificationCompat.BigTextStyle().bigText(reply))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(System.currentTimeMillis().toInt(), notification)
    }

    private fun statusText(resId: Int): String = getString(resId)

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val THRESHOLD = 0.85f
        private const val COOLDOWN_MS = 3000L
        const val FOREGROUND_NOTIFICATION_ID = 4200

        fun start(context: Context) {
            val intent = Intent(context, WakeWordService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, WakeWordService::class.java))
        }
    }
}
