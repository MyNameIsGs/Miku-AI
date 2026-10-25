// Ícono de Miku en la bandeja de Windows (2026-09-29, pedido de Sebastián:
// la ventana no está en la barra de tareas, y escondida no había dónde
// encontrarla). Siempre visible, con el ícono de la app (el cebollín).
//
// - Clic: la esconde o la trae (lo mismo que Ctrl+Shift+H, con su animación).
// - Menú (clic derecho): mostrar/esconder, bloquear/desbloquear, y Salir.
//
// Todo lo hace el frontend (eventos "tray-toggle", "tray-click-through" y
// "tray-quit"):
// esconder tiene animación, y salir tiene que cerrar como el botón de la
// barra (apaga el servidor de voz; al cerrar la ventana se sincroniza la
// memoria). Si el frontend no responde, "Salir" cierra igual a los 8 s.

use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Mostrar / esconder a Miku", true, None::<&str>)?;
    // Con Miku bloqueada la barra no aparece: esto (o Ctrl+Shift+M) la destraba.
    let lock = MenuItem::with_id(app, "click-through", "Bloquear / desbloquear (Ctrl+Shift+M)", true, None::<&str>)?;
    // Luces (fase 5 de docs/luces-argb/PLAN.md).
    let lights = MenuItem::with_id(app, "lights-toggle", "Luces: prender / apagar", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "lights-next", "Luces: siguiente favorito (Ctrl+Alt+1…9)", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &lock, &lights, &next, &quit])?;

    let mut builder = TrayIconBuilder::with_id("miku")
        .tooltip("Miku")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                let _ = app.emit("tray-toggle", ());
            }
            "click-through" => {
                let _ = app.emit("tray-click-through", ());
            }
            "lights-toggle" => {
                let _ = app.emit("tray-lights-toggle", ());
            }
            "lights-next" => {
                let _ = app.emit("tray-lights-next", ());
            }
            "quit" => {
                let _ = app.emit("tray-quit", ());
                let handle = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(8));
                    handle.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = tray.app_handle().emit("tray-toggle", ());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
