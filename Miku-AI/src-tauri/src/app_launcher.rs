use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// Tarea 6.2: descubrimiento automático de aplicaciones instaladas, escaneando
// los accesos directos (.lnk) del menú Inicio -- ni se registran a mano ni
// se resuelve a qué apuntan, Windows hace eso solo al ejecutar el .lnk.
#[derive(Serialize, Clone)]
pub struct DiscoveredApp {
    pub name: String,
    pub path: String,
}

fn collect_lnk_files(dir: &Path, out: &mut Vec<DiscoveredApp>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_lnk_files(&path, out);
        } else if path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("lnk"))
            .unwrap_or(false)
        {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                out.push(DiscoveredApp {
                    name: stem.to_string(),
                    path: path.to_string_lossy().to_string(),
                });
            }
        }
    }
}

// Steam no crea accesos directos de menú Inicio para los juegos instalados
// (solo para el cliente en sí) desde hace varias versiones -- verificado
// contra una instalación real con más de 80 juegos en tres bibliotecas y
// cero .lnk de juegos. Hace falta leer los manifiestos de Steam
// directamente. El formato VDF de Valve es texto plano con pares
// "clave" "valor" por línea -- no hace falta un parser completo, solo
// extraer el valor entre comillas de las claves que interesan.
fn extract_quoted_value(after_key: &str) -> Option<String> {
    let start = after_key.find('"')? + 1;
    let rest = &after_key[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_vdf_field(content: &str, field: &str) -> Option<String> {
    let key = format!("\"{}\"", field);
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(&key) {
            return extract_quoted_value(rest);
        }
    }
    None
}

fn find_steam_install_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\WOW6432Node\Valve\Steam",
                "/v",
                "InstallPath",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;

        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if let Some(idx) = line.find("REG_SZ") {
                let path = line[idx + "REG_SZ".len()..].trim();
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }
    }
    None
}

// La biblioteca principal (junto al .exe de Steam) casi nunca tiene los
// juegos -- libraryfolders.vdf lista las demás (otros discos, etc.).
fn find_steam_library_paths(steam_path: &Path) -> Vec<PathBuf> {
    let mut paths = vec![steam_path.to_path_buf()];
    let vdf_path = steam_path.join("steamapps").join("libraryfolders.vdf");

    if let Ok(content) = std::fs::read_to_string(&vdf_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("\"path\"") {
                if let Some(raw) = extract_quoted_value(rest) {
                    let normalized = PathBuf::from(raw.replace("\\\\", "\\"));
                    if !paths.contains(&normalized) {
                        paths.push(normalized);
                    }
                }
            }
        }
    }

    paths
}

// Cada juego instalado tiene un appmanifest_<id>.acf en steamapps/. Se
// lanza con el protocolo steam://rungameid/<id> -- lo resuelve Steam
// mismo (lo abre si no está corriendo), es más confiable que buscar el
// .exe real del juego a mano.
fn collect_steam_games(out: &mut Vec<DiscoveredApp>) {
    let Some(steam_path) = find_steam_install_path() else {
        return;
    };

    for library in find_steam_library_paths(&steam_path) {
        let steamapps_dir = library.join("steamapps");
        let entries = match std::fs::read_dir(&steamapps_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let is_manifest = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("appmanifest_") && n.ends_with(".acf"))
                .unwrap_or(false);
            if !is_manifest {
                continue;
            }

            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let appid = extract_vdf_field(&content, "appid");
            let name = extract_vdf_field(&content, "name");

            if let (Some(appid), Some(name)) = (appid, name) {
                out.push(DiscoveredApp {
                    name,
                    path: format!("steam://rungameid/{}", appid),
                });
            }
        }
    }
}

// Las apps de Microsoft Store (UWP/MSIX, ej. Spotify) no viven como .lnk en
// ninguna carpeta -- están empaquetadas y Windows las resuelve por su
// AppUserModelID (formato "PackageFamilyName!AppId"). `Get-StartApps` es el
// cmdlet que ya usa el propio Start Menu de Windows para enumerarlas;
// verificado contra esta máquina que devuelve el AppID correcto para
// lanzarlas. Se filtra a las que tienen "!" en el AppID -- las demás que
// devuelve Get-StartApps ya se cubren con el escaneo de .lnk.
#[derive(Deserialize)]
struct StartApp {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "AppID")]
    app_id: String,
}

fn collect_uwp_apps(out: &mut Vec<DiscoveredApp>) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-StartApps | Where-Object { $_.AppID -match '!' } | ConvertTo-Json -Compress",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let Ok(output) = output else {
            return;
        };
        let text = String::from_utf8_lossy(&output.stdout);
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return;
        }

        // ConvertTo-Json devuelve un objeto suelto si hay un solo
        // resultado, y un array si hay dos o más -- hay que probar ambos.
        let apps: Vec<StartApp> = if trimmed.starts_with('[') {
            serde_json::from_str(trimmed).unwrap_or_default()
        } else {
            serde_json::from_str::<StartApp>(trimmed)
                .map(|a| vec![a])
                .unwrap_or_default()
        };

        for app in apps {
            out.push(DiscoveredApp {
                name: app.name,
                path: format!("appid:{}", app.app_id),
            });
        }
    }
}

#[tauri::command]
pub fn scan_installed_apps() -> Result<Vec<DiscoveredApp>, String> {
    let mut apps = Vec::new();

    if let Ok(program_data) = std::env::var("ProgramData") {
        collect_lnk_files(
            &PathBuf::from(program_data).join("Microsoft\\Windows\\Start Menu\\Programs"),
            &mut apps,
        );
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        collect_lnk_files(
            &PathBuf::from(appdata).join("Microsoft\\Windows\\Start Menu\\Programs"),
            &mut apps,
        );
    }

    collect_steam_games(&mut apps);
    collect_uwp_apps(&mut apps);

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));

    Ok(apps)
}

// No usa ningún plugin de Tauri (ver §6.3 del contexto). Dos mecanismos
// según el tipo de entrada:
// - "appid:<AppUserModelID>" (apps de Microsoft Store, ver collect_uwp_apps)
//   se lanza con `explorer.exe shell:AppsFolder\<id>` -- verificado que
//   funciona (probado con Spotify real en esta máquina).
// - Cualquier otra cosa (.lnk, .bat, .exe, URL, steam://...) se lanza vía
//   `cmd /c start`, que usa ShellExecute y deja que Windows resuelva el
//   destino, igual que un doble clic en el menú Inicio.
#[tauri::command]
pub fn launch_app_by_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        if let Some(app_id) = path.strip_prefix("appid:") {
            Command::new("explorer.exe")
                .arg(format!("shell:AppsFolder\\{}", app_id))
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("No se pudo lanzar \"{}\": {}", app_id, e))?;
            return Ok(());
        }

        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("No se pudo lanzar \"{}\": {}", path, e))?;
    }
    Ok(())
}
