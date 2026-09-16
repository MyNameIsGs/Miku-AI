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
fn sync_memory_to_github(repo_root: String) -> Result<(), String> {
    use std::path::PathBuf;
    use std::process::Command;

    if repo_root.is_empty() {
        return Err("VITE_REPO_ROOT no configurado".to_string());
    }

    // Origen: %APPDATA%\com.sebas.mikuai\memory\
    let appdata = std::env::var("APPDATA")
        .map_err(|e| format!("Sin APPDATA: {}", e))?;

    let memory_src = PathBuf::from(&appdata)
        .join("com.sebas.mikuai")
        .join("memory");

    let memory_dest = PathBuf::from(&repo_root).join("memory");

    std::fs::create_dir_all(&memory_dest)
        .map_err(|e| format!("No se pudo crear memory/: {}", e))?;

    // Copiar solo los .md principales (no los .backup.md)
    for filename in &["personality.md", "memories.md", "world.md"] {
        let src = memory_src.join(filename);
        let dst = memory_dest.join(filename);
        if src.exists() {
            std::fs::copy(&src, &dst)
                .map_err(|e| format!("Error copiando {}: {}", filename, e))?;
        }
    }

    // git add memory/
    Command::new("git")
        .args(["-C", &repo_root, "add", "memory/"])
        .output()
        .map_err(|e| format!("git add: {}", e))?;

    // Verificar si hay cambios staged
    // exit 0 = sin cambios, exit 1 = hay cambios
    let status = Command::new("git")
        .args(["-C", &repo_root, "diff", "--cached", "--quiet"])
        .status()
        .map_err(|e| format!("git diff: {}", e))?;

    if status.success() {
        // Sin cambios: nada que hacer, no es error
        return Ok(());
    }

    // git commit con timestamp
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    Command::new("git")
        .args(["-C", &repo_root, "commit", "-m", &format!("memory: sync {}", ts)])
        .output()
        .map_err(|e| format!("git commit: {}", e))?;

    // git push
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
    // Limpiar posibles procesos huérfanos anteriores al iniciar
    kill_voice_server();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![log_to_terminal, kill_voice_server,  sync_memory_to_github,])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            kill_voice_server();
        }
    });
}