package com.sebas.mikuai.wakeword

import android.content.Context
import android.graphics.PixelFormat
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.sebas.mikuai.ui.theme.MikuTheme

/**
 * Ventana de overlay de verdad (`TYPE_APPLICATION_OVERLAY`) para la
 * pantalla flotante estilo "Hey Gemini" -- el camino PRINCIPAL, aparece al
 * instante sin pasar por notificaciones, sin importar si la pantalla está
 * bloqueada o en uso activo (a diferencia de `MikuOverlayActivity`, que
 * depende de una notificación de pantalla completa que Android solo abre
 * sola con el teléfono bloqueado -- confirmado con Sebastián que en uso
 * activo se quedaba como notificación que había que tocar, no es un bug,
 * es la política de la plataforma contra "publicidad a pantalla completa").
 *
 * Necesita el permiso especial "Mostrar sobre otras apps"
 * (`Settings.canDrawOverlays`, se pide desde Configuración) -- si no está
 * dado, `WakeWordService.showOverlay()` cae al camino de la Activity.
 *
 * Una `ComposeView` fuera de una Activity no tiene automáticamente quién
 * le provea `LifecycleOwner`/`ViewModelStoreOwner`/`SavedStateRegistryOwner`
 * (eso lo da la Activity normalmente) -- sin proveerlo a mano, Compose
 * tira `IllegalStateException` al intentar dibujar. `OverlayLifecycleOwner`
 * de acá abajo es esa implementación mínima.
 */
object MikuOverlayWindow {

    private var windowManager: WindowManager? = null
    private var composeView: ComposeView? = null
    private var lifecycleOwner: OverlayLifecycleOwner? = null

    fun isPermissionGranted(context: Context): Boolean = Settings.canDrawOverlays(context)

    /** No hace nada si ya está mostrada, o si falta el permiso. */
    fun show(context: Context) {
        if (composeView != null) return
        if (!Settings.canDrawOverlays(context)) return

        val wm = context.applicationContext.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return

        val owner = OverlayLifecycleOwner()
        owner.performRestore(null)
        owner.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
        owner.handleLifecycleEvent(Lifecycle.Event.ON_START)
        owner.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)

        val view = ComposeView(context.applicationContext).apply {
            setViewTreeLifecycleOwner(owner)
            setViewTreeViewModelStoreOwner(owner)
            setViewTreeSavedStateRegistryOwner(owner)
            setContent {
                MikuTheme {
                    val phase by MikuOverlayState.phase.collectAsState()

                    LaunchedEffect(phase) {
                        if (phase is MikuOverlayPhase.Idle) hide(context)
                    }

                    OverlayScreen(phase = phase, onDismiss = { MikuOverlayState.update(MikuOverlayPhase.Idle) })
                }
            }
        }

        // MATCH_PARENT en los dos ejes a propósito: `OverlayScreen` dibuja
        // un scrim semitransparente de pantalla completa (para que tocar
        // "afuera" de la tarjeta la cierre, igual que la versión Activity)
        // con la tarjeta en sí anclada abajo -- si la ventana fuera
        // WRAP_CONTENT, el scrim no tendría dónde dibujarse.
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // NOT_FOCUSABLE: no le roba el foco/teclado a la app de abajo.
            // SIN NOT_TOUCHABLE a propósito: sí queremos poder tocar la
            // tarjeta (cerrar, tocar afuera) -- mientras está abierta
            // bloquea el resto de la interacción, igual que hace "Hey
            // Gemini" en la referencia que mandó Sebastián.
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 0
        }

        try {
            wm.addView(view, params)
            windowManager = wm
            composeView = view
            lifecycleOwner = owner
        } catch (e: Exception) {
            // sin permiso pese al chequeo (raro, pero puede pasar en
            // algunos OEM), o el sistema lo rechazó -- no rompe nada más,
            // WakeWordService ya cayó a este camino como el principal,
            // no hay a qué degradar desde acá.
        }
    }

    fun hide(context: Context) {
        val wm = windowManager
        val view = composeView
        if (wm != null && view != null) {
            try {
                wm.removeView(view)
            } catch (e: Exception) {
            }
        }
        lifecycleOwner?.let {
            it.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
            it.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
            it.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
        }
        windowManager = null
        composeView = null
        lifecycleOwner = null
    }

    private class OverlayLifecycleOwner : LifecycleOwner, ViewModelStoreOwner, SavedStateRegistryOwner {
        private val lifecycleRegistry = LifecycleRegistry(this)
        private val savedStateRegistryController = SavedStateRegistryController.create(this)

        override val lifecycle: Lifecycle get() = lifecycleRegistry
        override val viewModelStore: ViewModelStore = ViewModelStore()
        override val savedStateRegistry: SavedStateRegistry get() = savedStateRegistryController.savedStateRegistry

        fun performRestore(bundle: Bundle?) = savedStateRegistryController.performRestore(bundle)
        fun handleLifecycleEvent(event: Lifecycle.Event) = lifecycleRegistry.handleLifecycleEvent(event)
    }
}
