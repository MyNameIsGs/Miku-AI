use windows::core::Result as WinResult;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
};

// Tarea 6.4: teclas multimedia virtuales, iguales a las que tiene un
// teclado con controles de medios -- Windows las enruta a la aplicación
// que tenga la sesión de reproducción activa en ese momento (Spotify,
// el navegador, lo que sea), sin que haya que saber cuál es.
fn send_virtual_key(vk: VIRTUAL_KEY) {
    let mut key_down = INPUT::default();
    key_down.r#type = INPUT_KEYBOARD;
    key_down.Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: vk,
            wScan: 0,
            dwFlags: Default::default(),
            time: 0,
            dwExtraInfo: 0,
        },
    };

    let mut key_up = INPUT::default();
    key_up.r#type = INPUT_KEYBOARD;
    key_up.Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: vk,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        },
    };

    unsafe {
        SendInput(&[key_down, key_up], std::mem::size_of::<INPUT>() as i32);
    }
}

#[tauri::command]
pub fn control_medios(accion: String) -> Result<(), String> {
    let vk = match accion.as_str() {
        "play_pausa" => VK_MEDIA_PLAY_PAUSE,
        "siguiente" => VK_MEDIA_NEXT_TRACK,
        "anterior" => VK_MEDIA_PREV_TRACK,
        other => return Err(format!("Acción de medios desconocida: {other}")),
    };
    send_virtual_key(vk);
    Ok(())
}

// Volumen absoluto (Core Audio, IAudioEndpointVolume) en vez de solo
// incremental -- reusa el mismo patrón de acceso a audio de
// audio_session.rs, pero apuntando al volumen maestro del endpoint, no a
// una sesión de aplicación puntual. Permite "ponlo al 30%", no solo
// "subilo/bajalo".
fn open_endpoint_volume() -> WinResult<IAudioEndpointVolume> {
    unsafe {
        // Igual que en audio_session.rs: si el hilo ya tiene COM
        // inicializado (con este u otro modelo), no es un error.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        device.Activate(CLSCTX_ALL, None)
    }
}

#[tauri::command]
pub fn ajustar_volumen(accion: String, nivel: Option<f64>) -> Result<f64, String> {
    let volume =
        open_endpoint_volume().map_err(|e| format!("No se pudo acceder al control de volumen: {e}"))?;

    unsafe {
        match accion.as_str() {
            "establecer" => {
                let target = (nivel.unwrap_or(50.0).clamp(0.0, 100.0) / 100.0) as f32;
                volume
                    .SetMasterVolumeLevelScalar(target, std::ptr::null())
                    .map_err(|e| format!("Error ajustando el volumen: {e}"))?;
            }
            "subir" | "bajar" => {
                let current = volume
                    .GetMasterVolumeLevelScalar()
                    .map_err(|e| format!("Error leyendo el volumen: {e}"))?;
                let step = (nivel.unwrap_or(10.0).abs() / 100.0) as f32;
                let signed_step = if accion == "subir" { step } else { -step };
                let target = (current + signed_step).clamp(0.0, 1.0);
                volume
                    .SetMasterVolumeLevelScalar(target, std::ptr::null())
                    .map_err(|e| format!("Error ajustando el volumen: {e}"))?;
            }
            "silenciar" => {
                volume
                    .SetMute(true, std::ptr::null())
                    .map_err(|e| format!("Error silenciando: {e}"))?;
            }
            "desilenciar" => {
                volume
                    .SetMute(false, std::ptr::null())
                    .map_err(|e| format!("Error desilenciando: {e}"))?;
            }
            other => return Err(format!("Acción de volumen desconocida: {other}")),
        }

        let final_level = volume
            .GetMasterVolumeLevelScalar()
            .map_err(|e| format!("Error leyendo el volumen: {e}"))?;
        Ok((final_level as f64 * 100.0).round())
    }
}
