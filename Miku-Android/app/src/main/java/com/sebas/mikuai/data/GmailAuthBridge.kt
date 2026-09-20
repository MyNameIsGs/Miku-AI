package com.sebas.mikuai.data

import android.app.PendingIntent
import android.content.Intent
import androidx.activity.result.IntentSenderRequest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// El flujo nativo de autorización de Google (AuthorizationClient) puede
// necesitar mostrar un diálogo del sistema (elegir cuenta, aprobar el
// scope) -- eso se resuelve con un ActivityResultLauncher registrado en
// MainActivity, no con un deep link como el de Spotify (Google restringe
// los esquemas de URL personalizados en Android). Mismo problema de fondo
// que SpotifyAuthBridge (conectar un callback de Activity con una función
// suspend del repositorio), resuelto con el mismo patrón de puente.
object GmailAuthBridge {
    @Volatile
    private var launcher: ((IntentSenderRequest) -> Unit)? = null

    @Volatile
    private var pending: CompletableDeferred<Intent?>? = null

    fun registerLauncher(launch: (IntentSenderRequest) -> Unit) {
        launcher = launch
    }

    suspend fun resolve(pendingIntent: PendingIntent): Intent? {
        val deferred = CompletableDeferred<Intent?>()
        pending = deferred
        val currentLauncher = launcher
            ?: throw IllegalStateException("No se pudo abrir el diálogo de autorización de Gmail -- volvé a intentarlo.")
        withContext(Dispatchers.Main) {
            currentLauncher(IntentSenderRequest.Builder(pendingIntent.intentSender).build())
        }
        return deferred.await()
    }

    fun onResult(data: Intent?) {
        pending?.complete(data)
        pending = null
    }
}
