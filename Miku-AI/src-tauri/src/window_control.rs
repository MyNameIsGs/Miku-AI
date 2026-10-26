use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, TerminateProcess, PROCESS_TERMINATE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, PostMessageW, SetWindowPos, ShowWindow, GW_OWNER, SW_MINIMIZE, SW_RESTORE,
    SWP_NOACTIVATE, SWP_NOZORDER, WM_CLOSE,
};
use xcap::Monitor;

// Tarea 8.5: control de ventanas -- minimizar, mover a otro monitor, "modo
// foco". Mismo patrón de enumeración de ventanas/procesos que
// focus_existing_window en app_launcher.rs (Toolhelp32 para PIDs por
// nombre de proceso, EnumWindows para ventanas top-level visibles), pero
// generalizado para encontrar TODAS las ventanas que coincidan, no solo la
// primera -- una app puede tener más de una ventana abierta, y "modo foco"
// además necesita la lista completa para saber cuáles minimizar.

pub(crate) fn find_pids_by_process_name(target_name: &str) -> Vec<u32> {
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

struct EnumAllContext {
    windows: Vec<HWND>,
}

unsafe extern "system" fn enum_all_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    unsafe {
        let ctx = &mut *(lparam.0 as *mut EnumAllContext);
        // Mismo filtro que focus_existing_window: con texto visible, y sin
        // "owner" (eso descarta diálogos/tooltips, que no son ventanas
        // principales).
        if IsWindowVisible(hwnd).as_bool()
            && GetWindowTextLengthW(hwnd) > 0
            && GetWindow(hwnd, GW_OWNER).is_err()
        {
            ctx.windows.push(hwnd);
        }
        true.into()
    }
}

fn all_top_level_windows() -> Vec<HWND> {
    let mut ctx = EnumAllContext { windows: Vec::new() };
    unsafe {
        let _ = EnumWindows(
            Some(enum_all_callback),
            LPARAM(&mut ctx as *mut EnumAllContext as isize),
        );
    }
    ctx.windows
}

fn windows_for_process(process_name: &str) -> Vec<HWND> {
    let target_pids = find_pids_by_process_name(process_name);
    if target_pids.is_empty() {
        return Vec::new();
    }
    all_top_level_windows()
        .into_iter()
        .filter(|&hwnd| {
            let mut pid: u32 = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
            }
            target_pids.contains(&pid)
        })
        .collect()
}

// Minimizar/mover no son destructivos (se deshacen en un clic) -- no pasan
// por la Tarea 6.5 de confirmación humana, mismo criterio que abrir apps.
// Cerrar: ver cerrar_aplicacion abajo -- el cierre normal es como apretar
// la X (la app puede preguntar si guardar), solo el forzado pide
// confirmación (desde el lado TS, ver windowControl.ts).

#[tauri::command]
pub fn minimizar_ventana(nombre_proceso: String) -> Result<u32, String> {
    let windows = windows_for_process(&nombre_proceso);
    if windows.is_empty() {
        return Err(format!(
            "No encontré ninguna ventana abierta de \"{}\".",
            nombre_proceso
        ));
    }

    for hwnd in &windows {
        unsafe {
            let _ = ShowWindow(*hwnd, SW_MINIMIZE);
        }
    }
    Ok(windows.len() as u32)
}

#[tauri::command]
pub fn mover_ventana(nombre_proceso: String, monitor: usize) -> Result<u32, String> {
    let monitors = Monitor::all().map_err(|e| format!("Error accediendo a los monitores: {e}"))?;
    let Some(target) = monitors.get(monitor.saturating_sub(1)) else {
        return Err(format!(
            "No existe el monitor {} (hay {} conectados).",
            monitor,
            monitors.len()
        ));
    };

    let x = target.x().map_err(|e| e.to_string())?;
    let y = target.y().map_err(|e| e.to_string())?;
    let width = target.width().map_err(|e| e.to_string())? as i32;
    let height = target.height().map_err(|e| e.to_string())? as i32;

    let windows = windows_for_process(&nombre_proceso);
    if windows.is_empty() {
        return Err(format!(
            "No encontré ninguna ventana abierta de \"{}\".",
            nombre_proceso
        ));
    }

    for hwnd in &windows {
        unsafe {
            // Restaurar antes de mover -- SetWindowPos sobre una ventana
            // minimizada no la trae de vuelta a un estado visible.
            if IsIconic(*hwnd).as_bool() {
                let _ = ShowWindow(*hwnd, SW_RESTORE);
            }
            // Ocupa el área completa del monitor destino -- simple y
            // predecible, en vez de intentar preservar tamaño/posición
            // relativa (que además puede quedar fuera del monitor nuevo si
            // es más chico que el de origen).
            let _ = SetWindowPos(
                *hwnd,
                None,
                x,
                y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
    Ok(windows.len() as u32)
}

#[tauri::command]
pub fn modo_foco(nombre_proceso: String) -> Result<u32, String> {
    let target_windows = windows_for_process(&nombre_proceso);
    if target_windows.is_empty() {
        return Err(format!(
            "No encontré ninguna ventana abierta de \"{}\".",
            nombre_proceso
        ));
    }

    let mut minimized = 0;
    for hwnd in all_top_level_windows() {
        if target_windows.contains(&hwnd) {
            continue;
        }
        unsafe {
            let _ = ShowWindow(hwnd, SW_MINIMIZE);
        }
        minimized += 1;
    }
    Ok(minimized)
}

// Cierre normal: le manda WM_CLOSE a cada ventana principal de la app, lo
// mismo que apretar la X -- la app decide (puede preguntar si guardar, o
// esconderse en la bandeja como Discord/Steam). Devuelve cuántas ventanas
// recibieron el pedido.
#[tauri::command]
pub fn cerrar_aplicacion(nombre_proceso: String) -> Result<u32, String> {
    let windows = windows_for_process(&nombre_proceso);
    if windows.is_empty() {
        let running = !find_pids_by_process_name(&nombre_proceso).is_empty();
        return Err(if running {
            format!(
                "\"{}\" está corriendo pero no tiene ninguna ventana abierta (seguramente está en la bandeja). Solo se puede cerrar forzándola.",
                nombre_proceso
            )
        } else {
            format!("\"{}\" no está abierta.", nombre_proceso)
        });
    }

    for hwnd in &windows {
        unsafe {
            let _ = PostMessageW(Some(*hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }
    Ok(windows.len() as u32)
}

// Cierre forzado: termina todos los procesos con ese nombre, sin dejar que
// la app guarde nada. Nunca el proceso de la propia Miku.
#[tauri::command]
pub fn forzar_cierre_aplicacion(nombre_proceso: String) -> Result<u32, String> {
    let own_pid = unsafe { GetCurrentProcessId() };
    let pids: Vec<u32> = find_pids_by_process_name(&nombre_proceso)
        .into_iter()
        .filter(|&pid| pid != own_pid)
        .collect();
    if pids.is_empty() {
        return Err(format!("\"{}\" no está abierta.", nombre_proceso));
    }

    let mut killed = 0;
    for pid in pids {
        unsafe {
            if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                if TerminateProcess(handle, 1).is_ok() {
                    killed += 1;
                }
                let _ = CloseHandle(handle);
            }
        }
    }
    if killed == 0 {
        return Err(format!(
            "No pude terminar \"{}\" (puede que necesite permisos de administrador).",
            nombre_proceso
        ));
    }
    Ok(killed)
}
