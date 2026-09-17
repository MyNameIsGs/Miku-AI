use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

const REPO: &str = "MyNameIsGs/Miku-AI";
const TAG: &str = "voice-server-assets";
const PROGRESS_EVENT: &str = "voice-server-download-progress";
// No emitir un evento por cada chunk (serian miles en una descarga de
// varios GB): solo cuando se cruza este umbral de bytes nuevos.
const PROGRESS_STEP_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Deserialize)]
struct Manifest {
    exe: ExeManifest,
}

#[derive(Deserialize)]
struct ExeManifest {
    size: u64,
    sha256: String,
    parts: Vec<String>,
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

/// Descarga miku-voice-server.exe desde la GitHub Release del proyecto si
/// `target_path` no existe todavia (instalacion limpia). El .exe no se
/// incluye en el instalador NSIS porque supera el limite de 2 GiB por
/// archivo, asi que se distribuye aparte, partido en fragmentos. Emite
/// `PROGRESS_EVENT` para que el frontend pueda mostrar una barra de avance.
pub async fn ensure_installed(target_path: &Path, app: &tauri::AppHandle) -> Result<(), String> {
    let parent = target_path
        .parent()
        .ok_or_else(|| "El ejecutable de destino no tiene directorio padre".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|e| format!("No se pudo crear {}: {e}", parent.display()))?;

    println!("[VOICE_SERVER_PROVISION] Descargando manifest.json ...");
    let manifest = fetch_manifest().await?;

    let tmp_path = target_path.with_extension("exe.download");
    println!(
        "[VOICE_SERVER_PROVISION] Descargando {} fragmento(s) (~{} MB) ...",
        manifest.exe.parts.len(),
        manifest.exe.size / 1_000_000
    );

    let download_result =
        download_parts(&manifest.exe.parts, &tmp_path, manifest.exe.size, app).await;
    if let Err(e) = download_result {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(e);
    }

    let actual_size = tokio::fs::metadata(&tmp_path)
        .await
        .map_err(|e| format!("No se pudo leer el archivo descargado: {e}"))?
        .len();
    if actual_size != manifest.exe.size {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(format!(
            "Tamano incorrecto tras descargar (esperado {} bytes, se obtuvieron {})",
            manifest.exe.size, actual_size
        ));
    }

    println!("[VOICE_SERVER_PROVISION] Verificando integridad (SHA256) ...");
    let tmp_path_owned = tmp_path.clone();
    let actual_hash = tokio::task::spawn_blocking(move || sha256_of_file(&tmp_path_owned))
        .await
        .map_err(|e| format!("Error interno verificando el hash: {e}"))??;

    if actual_hash != manifest.exe.sha256 {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(
            "El archivo descargado no coincide con el hash esperado (descarga corrupta)"
                .to_string(),
        );
    }

    tokio::fs::rename(&tmp_path, target_path)
        .await
        .map_err(|e| format!("No se pudo mover el ejecutable a {}: {e}", target_path.display()))?;

    println!("[VOICE_SERVER_PROVISION] Servidor de voz instalado correctamente.");
    Ok(())
}

async fn fetch_manifest() -> Result<Manifest, String> {
    let url = format!("https://github.com/{REPO}/releases/download/{TAG}/manifest.json");
    reqwest::get(&url)
        .await
        .map_err(|e| format!("No se pudo descargar manifest.json: {e}"))?
        .error_for_status()
        .map_err(|e| format!("manifest.json respondio con error: {e}"))?
        .json::<Manifest>()
        .await
        .map_err(|e| format!("manifest.json invalido: {e}"))
}

async fn download_parts(
    part_names: &[String],
    dest_path: &Path,
    total_size: u64,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let mut out = tokio::fs::File::create(dest_path)
        .await
        .map_err(|e| format!("No se pudo crear {}: {e}", dest_path.display()))?;

    let mut downloaded: u64 = 0;
    let mut last_emitted: u64 = 0;

    for part_name in part_names {
        println!("[VOICE_SERVER_PROVISION]   -> {part_name}");
        let url = format!("https://github.com/{REPO}/releases/download/{TAG}/{part_name}");
        let mut response = reqwest::get(&url)
            .await
            .map_err(|e| format!("No se pudo descargar {part_name}: {e}"))?
            .error_for_status()
            .map_err(|e| format!("{part_name} respondio con error: {e}"))?;

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("Error leyendo {part_name}: {e}"))?
        {
            out.write_all(&chunk)
                .await
                .map_err(|e| format!("Error escribiendo {}: {e}", dest_path.display()))?;

            downloaded += chunk.len() as u64;
            if downloaded - last_emitted >= PROGRESS_STEP_BYTES {
                last_emitted = downloaded;
                let _ = app.emit(
                    PROGRESS_EVENT,
                    DownloadProgress {
                        downloaded,
                        total: total_size,
                    },
                );
            }
        }
    }

    out.flush()
        .await
        .map_err(|e| format!("Error guardando {}: {e}", dest_path.display()))?;

    let _ = app.emit(
        PROGRESS_EVENT,
        DownloadProgress {
            downloaded,
            total: total_size,
        },
    );

    Ok(())
}

fn sha256_of_file(path: &Path) -> Result<String, String> {
    use std::io::Read;

    let mut file =
        std::fs::File::open(path).map_err(|e| format!("No se pudo abrir {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Error leyendo {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}
