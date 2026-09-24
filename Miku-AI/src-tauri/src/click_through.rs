use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, WebviewWindow};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

// Click-through por zonas. setIgnoreCursorEvents vuelve transparente la
// ventana ENTERA (Windows no permite hacerlo por partes), así que con Miku
// bloqueada tampoco se podía usar la barra -- solo destrabar con
// Ctrl+Shift+M. Técnica habitual para esto: vigilar el cursor cada ~30 ms
// y dejar la ventana transparente a los clics SOLO mientras el cursor no
// esté sobre una zona interactiva (la franja de la barra, un panel
// abierto); encima de una, se vuelve normal y los botones funcionan.
//
// Las zonas las manda el frontend en píxeles CSS relativos a la ventana
// (ver App.tsx); acá se pasan a píxeles físicos con el factor de escala.
#[derive(Deserialize, Clone, Copy)]
pub struct Region {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

struct State {
    enabled: bool,
    regions: Vec<Region>,
}

static STATE: Mutex<State> = Mutex::new(State {
    enabled: false,
    regions: Vec::new(),
});
static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

const POLL_INTERVAL: Duration = Duration::from_millis(30);

fn cursor_over_region(window: &WebviewWindow, regions: &[Region]) -> bool {
    let mut cursor = POINT::default();
    if unsafe { GetCursorPos(&mut cursor) }.is_err() {
        return false;
    }
    let (Ok(origin), Ok(scale)) = (window.inner_position(), window.scale_factor()) else {
        return false;
    };
    let x = (cursor.x - origin.x) as f64 / scale;
    let y = (cursor.y - origin.y) as f64 / scale;
    regions
        .iter()
        .any(|r| x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
}

fn start_watcher(window: WebviewWindow) {
    std::thread::spawn(move || {
        // None = todavía no se aplicó nada.
        let mut applied_ignore: Option<bool> = None;
        loop {
            let (enabled, regions) = match STATE.lock() {
                Ok(s) => (s.enabled, s.regions.clone()),
                Err(_) => (false, Vec::new()),
            };
            let over_region = enabled && cursor_over_region(&window, &regions);
            let want_ignore = enabled && !over_region;
            if applied_ignore != Some(want_ignore) {
                let _ = window.set_ignore_cursor_events(want_ignore);
                // Con la ventana ignorando el mouse, el frontend no recibe
                // eventos de hover: se le avisa por acá para mostrar u
                // ocultar la barra.
                let _ = window.emit("click-through-hover", enabled && over_region);
                applied_ignore = Some(want_ignore);
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    });
}

// Posición del cursor relativa a la ventana, en píxeles CSS (puede estar
// fuera: negativa o más grande que la ventana). Para que Miku siga el mouse
// con la mirada (ver useCursorGaze.ts): con click-through el frontend no
// recibe eventos del mouse, y fuera de la ventana nunca los recibe.
#[tauri::command]
pub fn cursor_position(window: WebviewWindow) -> Option<(f64, f64)> {
    let mut cursor = POINT::default();
    unsafe { GetCursorPos(&mut cursor) }.ok()?;
    let origin = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    Some((
        (cursor.x - origin.x) as f64 / scale,
        (cursor.y - origin.y) as f64 / scale,
    ))
}

#[tauri::command]
pub fn set_click_through(window: WebviewWindow, enabled: bool, regions: Vec<Region>) {
    if let Ok(mut state) = STATE.lock() {
        state.enabled = enabled;
        state.regions = regions;
    }
    if !WATCHER_STARTED.swap(true, Ordering::SeqCst) {
        start_watcher(window);
    }
}
