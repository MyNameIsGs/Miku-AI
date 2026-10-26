#[cfg(target_os = "windows")]
mod audio_session;
#[cfg(target_os = "windows")]
mod voice_server_provision;
mod app_launcher;
mod media_control;
mod text_input;
mod window_control;
mod file_search;
mod mcp_client;
mod active_window;
mod obs_status;
mod click_through;
mod game_mode;
mod audio_device;
mod screen_capture;
mod oauth_loopback;
mod gmail_auth;
mod music_beat;
mod location;
mod tray;
mod openrgb;
mod lights_engine;
mod keyboard_strips;

// Tamaño de toda la app (Miku, barra y paneles), pedido de Sebastián: que
// ocupe menos pantalla. Es el zoom del webview -- el diseño sigue midiendo
// 750x720 px CSS por dentro, y la ventana (tauri.conf.json) es esto mismo
// por 0.8. Si se cambia, cambiar también el tamaño de la ventana allá.
// Las coordenadas de pantalla que van al frontend (cursor, zonas de clic,
// ventana activa) se pasan a px CSS dividiendo por esto.
pub(crate) const UI_ZOOM: f64 = 0.8;

#[tauri::command]
fn log_to_terminal(msg: String) {
    println!("{}", msg);
}

#[tauri::command]
fn kill_voice_server() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/IM", "miku-voice-server*"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}
// git sin ventana de consola: la app es GUI, y sin CREATE_NO_WINDOW cada
// sync de memoria abría (y cerraba) una ventana de CMD encima de lo que
// estuviera haciendo Sebastián, por ejemplo en pleno juego.
fn git_command() -> std::process::Command {
    let mut cmd = std::process::Command::new("git");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[tauri::command]
fn pull_memory_from_github(repo_root: String) -> Result<(), String> {
    use std::path::PathBuf;

    if repo_root.is_empty() {
        return Err("VITE_REPO_ROOT no configurado".to_string());
    }

    let appdata = std::env::var("APPDATA")
        .map_err(|e| format!("Sin APPDATA: {}", e))?;

    let memory_repo = PathBuf::from(&repo_root).join("memory");
    let memory_local = PathBuf::from(&appdata)
        .join("com.sebas.mikuai")
        .join("memory");

    // 1. Pull primero — traer lo más reciente del remoto
    let pull = git_command()
        .args(["-C", &repo_root, "pull", "--rebase", "origin", "main"])
        .output()
        .map_err(|e| format!("git pull: {}", e))?;

    if !pull.status.success() {
        return Err(format!(
            "git pull falló: {}",
            String::from_utf8_lossy(&pull.stderr)
        ));
    }

    // 2. Copiar repo → %APPDATA% (versión más reciente al LLM)
    std::fs::create_dir_all(&memory_local)
        .map_err(|e| format!("No se pudo crear carpeta de memoria: {}", e))?;

    for filename in &["personality.md", "memories.md", "world.md", "pendientes.json", "diario.md", "conocimiento.md", "reacciones_tacto.json", "sueno.json", "musica.json", "caras_animo.json"] {
        let src = memory_repo.join(filename);
        let dst = memory_local.join(filename);
        if src.exists() {
            std::fs::copy(&src, &dst)
                .map_err(|e| format!("Error copiando {}: {}", filename, e))?;
        }
    }

    Ok(())
}
// Vite puede recargar la pagina (HMR) sin reiniciar el proceso de Rust, y
// cada recarga vuelve a invocar este comando desde el useEffect de
// useVoiceServer. Sin este guard, cada recarga lanzaba OTRA copia entera
// del servidor de voz, todas compitiendo por la misma GPU.
#[cfg(target_os = "windows")]
static VOICE_SERVER_LAUNCHED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
async fn launch_voice_server(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Sin ruta del exe: {}", e))?
            .parent()
            .ok_or("Sin directorio del exe")?
            .to_path_buf();

        // Dev (debug):  target/debug/ → ../../binaries/miku-voice-server-x86_64-pc-windows-msvc.exe
        // Release:      junto al exe instalado → miku-voice-server.exe
        #[cfg(debug_assertions)]
        let server_path = exe_dir
            .join("..")
            .join("..")
            .join("binaries")
            .join("miku-voice-server-x86_64-pc-windows-msvc.exe");

        #[cfg(not(debug_assertions))]
        let server_path = exe_dir.join("miku-voice-server.exe");

        if !server_path.exists() {
            #[cfg(not(debug_assertions))]
            {
                voice_server_provision::ensure_installed(&server_path, &app)
                    .await
                    .map_err(|e| format!("No se pudo descargar el servidor de voz: {e}"))?;
            }
            #[cfg(debug_assertions)]
            {
                return Err(format!(
                    "Servidor de voz no encontrado en: {}",
                    server_path.display()
                ));
            }
        }

        if VOICE_SERVER_LAUNCHED.swap(true, std::sync::atomic::Ordering::SeqCst) {
            println!("[INFO] El servidor de voz ya fue lanzado en este proceso; se omite un relanzamiento.");
            return Ok(());
        }

        Command::new(&server_path)
            .env("SystemRoot", "C:\\Windows")
            .env("SYSTEMROOT", "C:\\Windows")
            .env("PATH", "C:\\Windows\\System32;C:\\Windows;C:\\ffmpeg\\bin")
            .env("PYTHONUNBUFFERED", "1")
            // El watchdog del servidor vigila este PID y se cierra si la app muere
            // (el padre directo del proceso Python es el bootloader de PyInstaller).
            .env("MIKU_APP_PID", std::process::id().to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Error al lanzar el servidor: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn sync_memory_to_github(repo_root: String) -> Result<(), String> {
    use std::path::PathBuf;

    if repo_root.is_empty() {
        return Err("VITE_REPO_ROOT no configurado".to_string());
    }

    let appdata = std::env::var("APPDATA")
        .map_err(|e| format!("Sin APPDATA: {}", e))?;

    let memory_src = PathBuf::from(&appdata)
        .join("com.sebas.mikuai")
        .join("memory");

    let memory_dest = PathBuf::from(&repo_root).join("memory");

    std::fs::create_dir_all(&memory_dest)
        .map_err(|e| format!("No se pudo crear memory/: {}", e))?;

    for filename in &["personality.md", "memories.md", "world.md", "pendientes.json", "diario.md", "conocimiento.md", "reacciones_tacto.json", "sueno.json", "musica.json", "caras_animo.json"] {
        let src = memory_src.join(filename);
        let dst = memory_dest.join(filename);
        if src.exists() {
            std::fs::copy(&src, &dst)
                .map_err(|e| format!("Error copiando {}: {}", filename, e))?;
        }
    }

    git_command()
        .args(["-C", &repo_root, "add", "memory/"])
        .output()
        .map_err(|e| format!("git add: {}", e))?;

    let status = git_command()
        .args(["-C", &repo_root, "diff", "--cached", "--quiet"])
        .status()
        .map_err(|e| format!("git diff: {}", e))?;

    if status.success() {
        return Ok(());
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    git_command()
        .args(["-C", &repo_root, "commit", "-m", &format!("memory: sync {}", ts)])
        .output()
        .map_err(|e| format!("git commit: {}", e))?;

    let mut push = git_command()
        .args(["-C", &repo_root, "push"])
        .output()
        .map_err(|e| format!("git push: {}", e))?;

    // GitHub puede tener commits que esta PC no tiene: el ánimo compartido
    // se escribe directo por la API (ver src/lib/sharedMood.ts), y el
    // celular escribe su memoria igual. Sin esto el push se rechazaba, y
    // la memoria de la PC quedaba sin subir (pasó el 2026-09-29). Se
    // traen, se pone lo de la PC encima y se reintenta. Si chocaran (los
    // dos cambiaron las mismas líneas), se cancela sin tocar nada: queda
    // commiteado local y se reintenta en el próximo sync.
    if !push.status.success() {
        let pull = git_command()
            .args(["-C", &repo_root, "pull", "--rebase", "--autostash", "--quiet"])
            .output()
            .map_err(|e| format!("git pull: {}", e))?;
        if !pull.status.success() {
            let _ = git_command()
                .args(["-C", &repo_root, "rebase", "--abort"])
                .output();
            return Err(format!(
                "git pull --rebase falló: {}",
                String::from_utf8_lossy(&pull.stderr)
            ));
        }
        push = git_command()
            .args(["-C", &repo_root, "push"])
            .output()
            .map_err(|e| format!("git push: {}", e))?;
    }

    if !push.status.success() {
        return Err(format!(
            "git push falló: {}",
            String::from_utf8_lossy(&push.stderr)
        ));
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    kill_voice_server();

    #[cfg(target_os = "windows")]
    audio_session::install();

    #[cfg(target_os = "windows")]
    active_window::start_tracker();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // #17: aviso de Windows con lo que dice cuando está escondida.
        .plugin(tauri_plugin_notification::init())
        // Arrancar con Windows (se prende desde la app instalada, ver Configuración).
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.set_zoom(UI_ZOOM) {
                    eprintln!("[VENTANA] No se pudo achicar la app: {e}");
                }
            }
            // Ícono en la bandeja de Windows (ver tray.rs).
            if let Err(e) = tray::create(app.handle()) {
                eprintln!("[BANDEJA] No se pudo crear el ícono: {e}");
            }
            // Luces RGB: el motor de efectos (ver lights_engine.rs) y OpenRGB
            // abierto con su servidor (ver openrgb.rs).
            lights_engine::start(app.handle().clone());
            tauri::async_runtime::spawn(async {
                if let Err(e) = openrgb::ensure_server().await {
                    eprintln!("[LUCES] {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_to_terminal,
            kill_voice_server,
            launch_voice_server,
            sync_memory_to_github,
            pull_memory_from_github,
            app_launcher::scan_installed_apps,
            app_launcher::launch_app_by_path,
            media_control::control_medios,
            media_control::ajustar_volumen,
            openrgb::rgb_listar,
            openrgb::rgb_estado,
            openrgb::rgb_poner_color,
            openrgb::rgb_pintar_zona,
            openrgb::rgb_redimensionar_zona,
            openrgb::rgb_modo_hardware,
            lights_engine::luces_escena,
            lights_engine::luces_rehacer_directo,
            lights_engine::luces_global,
            lights_engine::luces_probar_zona,
            lights_engine::luces_vista_previa,
            lights_engine::luces_voz,
            lights_engine::luces_estado_miku,
            lights_engine::luces_animo,
            lights_engine::luces_destello,
            lights_engine::luces_exportar,
            lights_engine::luces_importar,
            keyboard_strips::teclado_tiras_leer,
            keyboard_strips::teclado_tiras_poner,
            text_input::escribir_texto,
            window_control::minimizar_ventana,
            window_control::mover_ventana,
            window_control::modo_foco,
            window_control::cerrar_aplicacion,
            window_control::forzar_cierre_aplicacion,
            file_search::buscar_archivos,
            mcp_client::mcp_connect,
            mcp_client::mcp_call_tool,
            mcp_client::mcp_disconnect,
            mcp_client::mcp_is_connected,
            active_window::ventana_activa,
            active_window::segundos_sin_usar_pc,
            music_beat::escuchar_musica,
            obs_status::obs_estado,
            click_through::set_click_through,
            click_through::cursor_position,
            game_mode::set_game_mode_enabled,
            game_mode::game_mode_hide,
            game_mode::game_mode_show,
            game_mode::game_mode_is_hidden,
            location::mi_ubicacion,
            active_window::ventana_activa_lugar,
            audio_device::list_audio_output_devices,
            audio_device::set_default_audio_output,
            screen_capture::capture_screens,
            oauth_loopback::oauth_wait_for_redirect,
            gmail_auth::gmail_exchange_code,
            gmail_auth::gmail_refresh_token,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            lights_engine::on_exit();
            kill_voice_server();
        }
    });
}