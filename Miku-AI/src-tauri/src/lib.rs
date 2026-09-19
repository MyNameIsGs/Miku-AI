#[cfg(target_os = "windows")]
mod audio_session;
#[cfg(target_os = "windows")]
mod voice_server_provision;
mod app_launcher;
mod media_control;
mod audio_device;
mod screen_capture;
mod oauth_loopback;
mod gmail_auth;

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
#[tauri::command]
fn pull_memory_from_github(repo_root: String) -> Result<(), String> {
    use std::path::PathBuf;
    use std::process::Command;

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
    let pull = Command::new("git")
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

    for filename in &["personality.md", "memories.md", "world.md", "pendientes.json"] {
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
    use std::process::Command;

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

    for filename in &["personality.md", "memories.md", "world.md", "pendientes.json"] {
        let src = memory_src.join(filename);
        let dst = memory_dest.join(filename);
        if src.exists() {
            std::fs::copy(&src, &dst)
                .map_err(|e| format!("Error copiando {}: {}", filename, e))?;
        }
    }

    Command::new("git")
        .args(["-C", &repo_root, "add", "memory/"])
        .output()
        .map_err(|e| format!("git add: {}", e))?;

    let status = Command::new("git")
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

    Command::new("git")
        .args(["-C", &repo_root, "commit", "-m", &format!("memory: sync {}", ts)])
        .output()
        .map_err(|e| format!("git commit: {}", e))?;

    let push = Command::new("git")
        .args(["-C", &repo_root, "push"])
        .output()
        .map_err(|e| format!("git push: {}", e))?;

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

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
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
            kill_voice_server();
        }
    });
}