use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// Tarea 6.2: descubrimiento automático de aplicaciones instaladas, escaneando
// los accesos directos (.lnk) del menú Inicio -- ni se registran a mano ni
// se resuelve a qué apuntan, Windows hace eso solo al ejecutar el .lnk.
//
// `process_name` (Tarea 6.2, mejora post-lanzamiento): nombre del .exe al
// que apunta el acceso directo, si se pudo resolver. Sirve para, antes de
// lanzar de nuevo, buscar si ya hay una ventana de ese proceso abierta y
// traerla al frente en vez de abrir una ventana nueva -- reportado con
// Opera GX, que abre una ventana nueva cada vez que se relanza el .lnk
// (comportamiento normal del navegador, pero evitable si detectamos la
// instancia existente). None para Steam/UWP/apps personalizadas: no vale
// la pena resolver su proceso real (variable por juego, o ya lo maneja el
// propio sistema).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredApp {
    pub name: String,
    pub path: String,
    pub process_name: Option<String>,
}

// Lee el .lnk con la crate `lnk` (parser puro, sin depender de COM) y
// devuelve el nombre de archivo del ejecutable al que apunta.
fn resolve_lnk_process_name(lnk_path: &Path) -> Option<String> {
    let shortcut = lnk::ShellLink::open(lnk_path, lnk::encoding::WINDOWS_1252).ok()?;
    let target = shortcut.link_target()?;
    Path::new(&target)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
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
                    process_name: resolve_lnk_process_name(&path),
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
                    process_name: None,
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
                process_name: None,
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

// Trae al frente una ventana existente en vez de abrir una nueva -- ej.
// Opera GX (o cualquier navegador) abre una ventana nueva cada vez que se
// relanza el .lnk mientras ya está corriendo, aunque no sea una instancia
// nueva de verdad (comportamiento normal del navegador, verificado: el
// número de procesos no cambia al relanzarlo). Si encuentra una ventana
// visible de nivel superior perteneciente a ese proceso, la activa y
// devuelve true; si no encuentra nada, devuelve false para que el llamador
// lance la app normalmente.
#[cfg(target_os = "windows")]
fn focus_existing_window(process_name: &str) -> bool {
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::core::BOOL;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GW_OWNER, GetForegroundWindow, GetWindow,
        GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SW_RESTORE, SetForegroundWindow, ShowWindow,
    };

    fn find_pids_by_process_name(target_name: &str) -> Vec<u32> {
        let mut pids = Vec::new();
        unsafe {
            let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return pids;
            };

            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };

            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let exe_name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                    if exe_name.eq_ignore_ascii_case(target_name) {
                        pids.push(entry.th32ProcessID);
                    }
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }

            let _ = CloseHandle(snapshot);
        }
        pids
    }

    struct FindContext {
        target_pids: Vec<u32>,
        found: HWND,
    }

    unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        unsafe {
            let ctx = &mut *(lparam.0 as *mut FindContext);

            if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
                return true.into();
            }
            // Las ventanas con "owner" son diálogos/tooltips, no la ventana
            // principal -- GetWindow devuelve error cuando no hay owner.
            if GetWindow(hwnd, GW_OWNER).is_ok() {
                return true.into();
            }

            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));

            if ctx.target_pids.contains(&pid) {
                ctx.found = hwnd;
                return false.into();
            }
            true.into()
        }
    }

    let target_pids = find_pids_by_process_name(process_name);
    if target_pids.is_empty() {
        return false;
    }

    let mut ctx = FindContext {
        target_pids,
        found: HWND(std::ptr::null_mut()),
    };

    unsafe {
        let _ = EnumWindows(
            Some(enum_callback),
            LPARAM(&mut ctx as *mut FindContext as isize),
        );

        if ctx.found.0.is_null() {
            return false;
        }

        // Windows bloquea que un proceso en segundo plano le robe el foco a
        // otro -- adjuntar temporalmente el input del hilo actual al del
        // proceso en primer plano es el mecanismo estándar para evitarlo.
        let foreground = GetForegroundWindow();
        let foreground_thread = GetWindowThreadProcessId(foreground, None);
        let current_thread = GetCurrentThreadId();
        let needs_attach = foreground_thread != current_thread;

        if needs_attach {
            let _ = AttachThreadInput(current_thread, foreground_thread, true);
        }

        if IsIconic(ctx.found).as_bool() {
            let _ = ShowWindow(ctx.found, SW_RESTORE);
        }
        let _ = SetForegroundWindow(ctx.found);
        let _ = BringWindowToTop(ctx.found);

        if needs_attach {
            let _ = AttachThreadInput(current_thread, foreground_thread, false);
        }
    }

    true
}

// No usa ningún plugin de Tauri (ver §6.3 del contexto). `process_name` es
// opcional: cuando viene, primero se intenta traer al frente una ventana ya
// abierta de ese proceso (ver focus_existing_window) antes de lanzar nada
// nuevo. Si no hay ventana existente (o no se pasó process_name), se lanza
// según el tipo de entrada:
// - "appid:<AppUserModelID>" (apps de Microsoft Store, ver collect_uwp_apps)
//   se lanza con `explorer.exe shell:AppsFolder\<id>` -- verificado que
//   funciona (probado con Spotify real en esta máquina).
// - Cualquier otra cosa (.lnk, .exe, URL, steam://...) se lanza vía
//   `cmd /c start`, que usa ShellExecute y deja que Windows resuelva el
//   destino, igual que un doble clic en el menú Inicio.
// - .bat/.cmd son un caso aparte (ver más abajo): `start /D <carpeta>` NO
//   alcanza para ellos.
#[tauri::command]
pub fn launch_app_by_path(path: String, process_name: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        if let Some(name) = process_name.as_deref() {
            if focus_existing_window(name) {
                return Ok(());
            }
        }

        if let Some(app_id) = path.strip_prefix("appid:") {
            Command::new("explorer.exe")
                .arg(format!("shell:AppsFolder\\{}", app_id))
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("No se pudo lanzar \"{}\": {}", app_id, e))?;
            return Ok(());
        }

        let is_batch = Path::new(&path)
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("bat") || ext.eq_ignore_ascii_case("cmd"))
            .unwrap_or(false);

        if is_batch {
            // `cmd /c start` delega los .bat/.cmd a su asociación de
            // archivo, y esa asociación puede ignorar el /D que le pasemos
            // (verificado: en esta máquina termina abriendo un
            // `cmd /K <ruta>` con el directorio de trabajo en System32, no
            // en la carpeta del script). La única forma confiable de que
            // scripts con referencias relativas (ej. "call webui.bat")
            // funcionen es invocar cmd.exe directamente y fijar el
            // directorio de trabajo desde Rust con current_dir, sin pasar
            // por start/ShellExecute.
            //
            // A propósito SIN CREATE_NO_WINDOW ni stdout/stderr en null:
            // estos scripts (ej. levantar un servidor local) suelen
            // imprimir su progreso, errores, o la URL para abrir en el
            // navegador -- ocultar la consola dejaría a Sebastián sin esa
            // información, igual que si se ejecutaran silenciados.
            let mut command = Command::new("cmd");
            command.args(["/C", &path]);
            if let Some(parent) = Path::new(&path).parent() {
                if parent.exists() {
                    command.current_dir(parent);
                }
            }
            command
                .spawn()
                .map_err(|e| format!("No se pudo lanzar \"{}\": {}", path, e))?;
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
