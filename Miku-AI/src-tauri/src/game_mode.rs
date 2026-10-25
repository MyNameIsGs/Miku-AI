use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{Emitter, WebviewWindow};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsWindow,
    IsZoomed, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE,
    SW_SHOWNOACTIVATE,
};

use crate::active_window::process_name_for_pid;

// Modo juego: con un juego (o cualquier app) a pantalla completa en primer
// plano, Miku se oculta pero sigue funcionando, y "Hey Miku" la trae de
// vuelta. Ocultarla de verdad (no transparente) además libera la GPU: el
// navegador interno deja de dibujar el modelo 3D.
//
// Una vez detectado, el juego queda "anotado" y Miku sigue escondida
// aunque Sebastián cambie a otra ventana (Discord, el navegador, el
// escritorio): solo vuelve sola cuando esa ventana del juego se cierra, o
// cuando el juego vuelve al frente sin estar a pantalla completa (por
// ejemplo, un video del navegador que salió de pantalla completa).
//
// Por qué casi todo vive acá y no en el frontend: con la ventana oculta,
// WebView2 frena los temporizadores de la página (hasta uno por minuto
// después de unos minutos oculta) y detiene el bucle de dibujo -- el
// polling del wake-word del frontend podría tardar un minuto en reaccionar.
// Este hilo no se frena: detecta la pantalla completa, vigila el contador
// de "Hey Miku" del servidor de voz mientras está oculta, y le manda al
// frontend un latido (los eventos de Tauri le llegan aunque esté oculta)
// para lo que no puede esperar, como los recordatorios.
//
// Mostrar/ocultar va directo por Win32 y no con show()/hide() de Tauri:
// show() activa la ventana y le robaría el foco al juego (el teclado
// dejaría de ir al juego); SW_SHOWNOACTIVATE la muestra sin tocar el foco.
// Siempre los dos por acá, para no desincronizar el estado interno de
// Tauri (un hide() de Tauri después de un show por Win32 no haría nada).

static ENABLED: AtomicBool = AtomicBool::new(true);
static HIDDEN: AtomicBool = AtomicBool::new(false);
static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

const TICK: Duration = Duration::from_millis(250);
// Cada cuántos ticks se revisa la pantalla completa (~1 s) y se manda el
// latido mientras está oculta (~5 s).
const FULLSCREEN_EVERY_TICKS: u32 = 4;
const HEARTBEAT_EVERY_TICKS: u32 = 20;
// Cuántas revisiones seguidas (~1 s cada una) tiene que faltar el juego
// antes de soltarlo: algunos juegos cierran y vuelven a abrir su ventana al
// cambiar la resolución o entre pantallas de carga.
const RELEASE_AFTER_CHECKS: u32 = 3;
const WAKE_WORD_POLL_URL: &str = "http://127.0.0.1:8899/wake-word/poll";

// Herramientas del sistema que tapan la pantalla entera por un momento y no
// son juegos. Salen del registro de sesiones de juego de la PC de
// Sebastián: el recorte de Win+Shift+S (SnippingTool) y el Alt+Tab / Win+Tab
// (explorer) aparecían cientos de veces como "juegos".
const IGNORED_PROCESSES: &[&str] = &["snippingtool.exe", "screenclippinghost.exe", "explorer.exe"];

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameModeState {
    pub active: bool,
    pub title: String,
    pub process_name: String,
}

impl GameModeState {
    fn inactive() -> Self {
        GameModeState { active: false, title: String::new(), process_name: String::new() }
    }
}

// El juego anotado. La ventana se guarda como número: HWND no se puede
// mandar entre hilos.
struct TrackedGame {
    hwnd: isize,
    state: GameModeState,
}

fn window_text(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize]).trim().to_string()
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

enum Foreground {
    // La ventana en primer plano es la de Miku: no dice nada nuevo.
    Own,
    // Interfaz del sistema (escritorio, barra de tareas, recorte, Alt+Tab,
    // una ventana "No responde"): ni empieza un juego ni lo termina.
    System,
    Other { hwnd: isize, fullscreen: Option<(String, String)> },
}

// ¿La ventana en primer plano ocupa su monitor entero?
fn foreground_state() -> Foreground {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return Foreground::System;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == std::process::id() {
            return Foreground::Own;
        }
        let class = class_name(hwnd);
        // Escritorio, barra de tareas, y la interfaz del sistema que también
        // ocupa la pantalla entera (panel de emojis/teclado, Inicio): medido
        // en la PC de Sebastián, "Experiencia de entrada de Windows" cubre
        // el monitor igual que un juego. "Ghost" es la copia que pone
        // Windows cuando una ventana deja de responder ("Roblox (No
        // responde)"): sigue siendo el mismo juego.
        if matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Windows.UI.Core.CoreWindow" | "Ghost"
        ) {
            return Foreground::System;
        }
        let process = process_name_for_pid(pid).unwrap_or_default();
        if IGNORED_PROCESSES.contains(&process.to_lowercase().as_str()) {
            return Foreground::System;
        }

        let raw = hwnd.0 as isize;
        // Una ventana maximizada con la barra de tareas en auto-ocultar
        // también cubre el monitor entero -- no es un juego. Los juegos
        // "sin bordes" son ventanas del tamaño del monitor, no maximizadas.
        if IsZoomed(hwnd).as_bool() {
            return Foreground::Other { hwnd: raw, fullscreen: None };
        }

        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return Foreground::Other { hwnd: raw, fullscreen: None };
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Foreground::Other { hwnd: raw, fullscreen: None };
        }
        let m = info.rcMonitor;
        let covers = rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom;
        if !covers {
            return Foreground::Other { hwnd: raw, fullscreen: None };
        }
        Foreground::Other { hwnd: raw, fullscreen: Some((window_text(hwnd), process)) }
    }
}

fn window_exists(hwnd: isize) -> bool {
    unsafe { IsWindow(Some(HWND(hwnd as *mut _))).as_bool() }
}

fn main_hwnd(window: &WebviewWindow) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0))
}

fn show_without_focus(window: &WebviewWindow) {
    if let Some(hwnd) = main_hwnd(window) {
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
    HIDDEN.store(false, Ordering::SeqCst);
}

async fn wake_word_detection_id(client: &reqwest::Client) -> Option<u64> {
    let response = client.get(WAKE_WORD_POLL_URL).send().await.ok()?;
    let json: serde_json::Value = response.json().await.ok()?;
    json.get("detectionId")?.as_u64()
}

// Qué juego queda anotado después de mirar la ventana en primer plano.
// `missing` cuenta las revisiones seguidas en las que el juego anotado ya no
// está (cerrado, o al frente sin pantalla completa).
fn next_tracked(tracked: Option<TrackedGame>, missing: &mut u32) -> Option<TrackedGame> {
    if !ENABLED.load(Ordering::SeqCst) {
        *missing = 0;
        return None;
    }
    let foreground = foreground_state();

    // Un juego nuevo a pantalla completa reemplaza al anotado.
    if let Foreground::Other { hwnd, fullscreen: Some((title, process_name)) } = &foreground {
        *missing = 0;
        return Some(TrackedGame {
            hwnd: *hwnd,
            state: GameModeState { active: true, title: title.clone(), process_name: process_name.clone() },
        });
    }

    let game = tracked?;
    let gone = !window_exists(game.hwnd)
        || matches!(foreground, Foreground::Other { hwnd, fullscreen: None } if hwnd == game.hwnd);
    if !gone {
        *missing = 0;
        return Some(game);
    }
    *missing += 1;
    if *missing >= RELEASE_AFTER_CHECKS {
        *missing = 0;
        return None;
    }
    Some(game)
}

fn start_watcher(window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(800))
            .build()
            .unwrap_or_default();
        let mut last_state = GameModeState::inactive();
        let mut tracked: Option<TrackedGame> = None;
        let mut missing: u32 = 0;
        let mut tick: u32 = 0;
        // Base del contador de "Hey Miku" desde que se ocultó: solo cuenta
        // una detección NUEVA.
        let mut wake_baseline: Option<u64> = None;

        loop {
            tick = tick.wrapping_add(1);

            if tick % FULLSCREEN_EVERY_TICKS == 0 {
                tracked = next_tracked(tracked.take(), &mut missing);
                let next = tracked.as_ref().map(|g| g.state.clone()).unwrap_or_else(GameModeState::inactive);
                if next != last_state {
                    crate::lights_engine::set_in_game(next.active);
                    let _ = window.emit("game-mode", next.clone());
                    last_state = next;
                }
            }

            if HIDDEN.load(Ordering::SeqCst) {
                if let Some(id) = wake_word_detection_id(&client).await {
                    match wake_baseline {
                        None => wake_baseline = Some(id),
                        Some(base) if id > base => {
                            wake_baseline = None;
                            show_without_focus(&window);
                            let _ = window.emit("game-mode-summon", ());
                        }
                        _ => {}
                    }
                }
                if tick % HEARTBEAT_EVERY_TICKS == 0 {
                    let _ = window.emit("game-mode-heartbeat", ());
                }
            } else {
                wake_baseline = None;
            }

            tokio::time::sleep(TICK).await;
        }
    });
}

// Prender/apagar el ocultamiento automático (ajustes). Arranca el hilo la
// primera vez.
#[tauri::command]
pub fn set_game_mode_enabled(window: WebviewWindow, enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled && HIDDEN.load(Ordering::SeqCst) {
        show_without_focus(&window);
    }
    if !WATCHER_STARTED.swap(true, Ordering::SeqCst) {
        start_watcher(window);
    }
}

// Los llama el frontend DESPUÉS de su animación de salida / ANTES de la de
// entrada (ver useGameMode.ts).
#[tauri::command]
pub fn game_mode_hide(window: WebviewWindow) {
    if let Some(hwnd) = main_hwnd(&window) {
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
        HIDDEN.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn game_mode_show(window: WebviewWindow) {
    show_without_focus(&window);
}

// Para que Ctrl+Shift+H alterne: esconderla si está a la vista, traerla si
// está escondida (por Minimizar o por el modo juego).
#[tauri::command]
pub fn game_mode_is_hidden() -> bool {
    HIDDEN.load(Ordering::SeqCst)
}
