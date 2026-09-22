use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, SetWindowPos, ShowWindow, GW_OWNER, SW_MINIMIZE, SW_RESTORE, SWP_NOACTIVATE,
    SWP_NOZORDER,
};
use xcap::Monitor;

// Tarea 8.5: control de ventanas -- minimizar, mover a otro monitor, "modo
// foco". Mismo patrón de enumeración de ventanas/procesos que
// focus_existing_window en app_launcher.rs (Toolhelp32 para PIDs por
// nombre de proceso, EnumWindows para ventanas top-level visibles), pero
// generalizado para encontrar TODAS las ventanas que coincidan, no solo la
// primera -- una app puede tener más de una ventana abierta, y "modo foco"
// además necesita la lista completa para saber cuáles minimizar.

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
// Cerrar una ventana/proceso, si se agrega más adelante, sí debería pasar
// por ahí.

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
