use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use windows::core::PWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
};

// Tarea 8.3 (parte 1): qué ventana tiene Sebastián en primer plano -- el
// título y el .exe, vía Win32 (barato, sin captura de pantalla).
//
// Problema: cuando le escribe a Miku, la ventana en primer plano es la de
// Miku misma, lo cual no dice nada. Por eso un hilo chico anota cada
// segundo la última ventana en primer plano que NO sea de este proceso;
// eso es lo que se le pasa a Miku ("lo último que estaba usando antes de
// hablarte"). Por voz ("Hey Miku") la ventana de Miku no toma el foco, así
// que ahí es directamente la actual.
struct Tracked {
    title: String,
    process_name: String,
    // Última vez que se la vio en primer plano -- para decirle a Miku qué
    // tan vieja es la información.
    last_seen: Instant,
}

static LAST_EXTERNAL: Mutex<Option<Tracked>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindowInfo {
    pub title: String,
    pub process_name: String,
    // 0 si está en primer plano ahora mismo.
    pub seconds_ago: u64,
}

fn process_name_for_pid(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        result.ok()?;
        let full_path = String::from_utf16_lossy(&buf[..size as usize]);
        full_path.rsplit('\\').next().map(|s| s.to_string())
    }
}

// Ventana en primer plano ahora, si es de otra app (no de Miku) y tiene
// título -- el escritorio y la barra de tareas no cuentan.
fn current_external_foreground() -> Option<(String, String)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == std::process::id() {
            return None;
        }
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        let title = String::from_utf16_lossy(&buf[..len.max(0) as usize])
            .trim()
            .to_string();
        if title.is_empty() || title == "Program Manager" {
            return None;
        }
        let process_name = process_name_for_pid(pid)?;
        Some((title, process_name))
    }
}

pub fn start_tracker() {
    std::thread::spawn(|| loop {
        if let Some((title, process_name)) = current_external_foreground() {
            if let Ok(mut guard) = LAST_EXTERNAL.lock() {
                *guard = Some(Tracked {
                    title,
                    process_name,
                    last_seen: Instant::now(),
                });
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    });
}

#[tauri::command]
pub fn ventana_activa() -> Option<ActiveWindowInfo> {
    if let Some((title, process_name)) = current_external_foreground() {
        return Some(ActiveWindowInfo {
            title,
            process_name,
            seconds_ago: 0,
        });
    }
    let guard = LAST_EXTERNAL.lock().ok()?;
    guard.as_ref().map(|t| ActiveWindowInfo {
        title: t.title.clone(),
        process_name: t.process_name.clone(),
        seconds_ago: t.last_seen.elapsed().as_secs(),
    })
}
