use std::collections::HashMap;

use windows::core::{Interface, Result as WinResult, HSTRING};
use windows::Win32::Foundation::{CloseHandle, S_OK};
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioSessionControl, IAudioSessionControl2, IAudioSessionManager2,
    IAudioSessionNotification, IAudioSessionNotification_Impl, IMMDeviceEnumerator,
    MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::GetCurrentProcessId;

const APP_DISPLAY_NAME: &str = "Miku-AI";

/// Renombra en el mezclador de volumen de Windows la sesion de audio que crea
/// WebView2 (aparece como "Microsoft Edge WebView2" por defecto, porque el
/// audio lo reproduce ese subproceso, no Miku-AI.exe).
pub fn install() {
    if let Err(e) = install_inner() {
        println!("[AUDIO_SESSION] No se pudo instalar el renombrado de sesion: {e:?}");
    }
}

fn install_inner() -> WinResult<()> {
    unsafe {
        // wry/tao ya suelen inicializar COM en el hilo principal; si ya está
        // inicializado (con este u otro modelo de threading) no es un error.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;

        // Por si ya existiera una sesión (poco probable al arrancar).
        let sessions = session_manager.GetSessionEnumerator()?;
        let count = sessions.GetCount()?;
        for i in 0..count {
            if let Ok(session) = sessions.GetSession(i) {
                rename_if_ours(&session);
            }
        }

        // WebView2 todavía no reprodujo audio, así que su sesión no existe
        // todavía: nos suscribimos para renombrarla en cuanto se cree, la
        // primera vez que Miku hable.
        let notifier: IAudioSessionNotification = SessionNotifier.into();
        session_manager.RegisterSessionNotification(&notifier)?;

        // Miku-AI es un proceso de escritorio de larga duración: dejamos que
        // el manager y la suscripción vivan hasta que el proceso termine en
        // vez de encadenar su ciclo de vida al de esta función.
        std::mem::forget(session_manager);
        std::mem::forget(notifier);
    }
    Ok(())
}

#[windows::core::implement(IAudioSessionNotification)]
struct SessionNotifier;

impl IAudioSessionNotification_Impl for SessionNotifier_Impl {
    fn OnSessionCreated(&self, new_session: windows::core::Ref<'_, IAudioSessionControl>) -> WinResult<()> {
        if let Some(session) = new_session.as_ref() {
            rename_if_ours(session);
        }
        Ok(())
    }
}

fn rename_if_ours(session: &IAudioSessionControl) {
    unsafe {
        let Ok(session2) = session.cast::<IAudioSessionControl2>() else {
            return;
        };
        if session2.IsSystemSoundsSession() == S_OK {
            return;
        }
        let Ok(pid) = session2.GetProcessId() else {
            return;
        };
        if !is_descendant_of_current_process(pid) {
            return;
        }

        let _ = session.SetDisplayName(&HSTRING::from(APP_DISPLAY_NAME), std::ptr::null());

        if let Ok(exe_path) = std::env::current_exe() {
            let icon_ref = format!("{},0", exe_path.display());
            let _ = session.SetIconPath(&HSTRING::from(icon_ref), std::ptr::null());
        }
    }
}

fn is_descendant_of_current_process(pid: u32) -> bool {
    let current_pid = unsafe { GetCurrentProcessId() };
    if pid == current_pid {
        return true;
    }

    let Some(parents) = parent_pid_map() else {
        return false;
    };

    let mut cursor = pid;
    while let Some(&parent) = parents.get(&cursor) {
        if parent == current_pid {
            return true;
        }
        if parent == 0 || parent == cursor {
            break;
        }
        cursor = parent;
    }
    false
}

fn parent_pid_map() -> Option<HashMap<u32, u32>> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut map = HashMap::new();
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                map.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
        Some(map)
    }
}
