package com.sebas.mikuai.data

import android.net.Uri
import kotlinx.coroutines.CompletableDeferred

// El redirect de OAuth de Spotify vuelve como un Intent nuevo a
// MainActivity (deep link `mikuai://spotify-callback`, ver onNewIntent) --
// como el flujo de conexión corre en el ViewModel/repositorio, no en la
// Activity, hace falta un puente simple para pasarle la URI del redirect.
// Un solo CompletableDeferred alcanza porque solo puede haber una conexión
// de Spotify en curso a la vez.
object SpotifyAuthBridge {
    @Volatile
    private var pending: CompletableDeferred<Uri>? = null

    fun awaitRedirect(): CompletableDeferred<Uri> {
        val deferred = CompletableDeferred<Uri>()
        pending = deferred
        return deferred
    }

    fun onRedirectReceived(uri: Uri) {
        pending?.complete(uri)
        pending = null
    }
}
