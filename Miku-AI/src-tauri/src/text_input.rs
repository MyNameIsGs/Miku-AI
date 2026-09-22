use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    VIRTUAL_KEY, VK_RETURN,
};

// Tarea 8.4: dictado por voz en cualquier app -- mismo mecanismo que
// media_control.rs (SendInput de WinAPI), pero con KEYEVENTF_UNICODE en
// vez de un código de tecla virtual (VK_*): permite mandar cualquier
// carácter Unicode (tildes, ñ, emojis) letra por letra, sin depender de la
// distribución de teclado activa ni de mapear cada carácter a una tecla
// física. Windows lo entrega a la ventana que tenga el foco en ese
// momento -- no hace falta saber cuál es ni enfocarla a mano.
fn send_unicode_char(unit: u16) {
    let mut key_down = INPUT::default();
    key_down.r#type = INPUT_KEYBOARD;
    key_down.Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VIRTUAL_KEY(0),
            wScan: unit,
            dwFlags: KEYEVENTF_UNICODE,
            time: 0,
            dwExtraInfo: 0,
        },
    };

    let mut key_up = INPUT::default();
    key_up.r#type = INPUT_KEYBOARD;
    key_up.Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VIRTUAL_KEY(0),
            wScan: unit,
            dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        },
    };

    unsafe {
        SendInput(&[key_down, key_up], std::mem::size_of::<INPUT>() as i32);
    }
}

// KEYEVENTF_UNICODE no sirve para saltos de línea (no hay un "carácter
// Unicode de Enter" que los campos de texto interpreten como tal) -- hace
// falta la tecla virtual real.
fn send_enter() {
    let mut key_down = INPUT::default();
    key_down.r#type = INPUT_KEYBOARD;
    key_down.Anonymous = INPUT_0 {
        ki: KEYBDINPUT {
            wVk: VK_RETURN,
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
            wVk: VK_RETURN,
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
pub fn escribir_texto(texto: String) -> Result<(), String> {
    if texto.is_empty() {
        return Err("No se especificó qué escribir.".to_string());
    }

    // encode_utf16() ya entrega los pares subrogados correctos para
    // caracteres fuera del plano básico (emojis) -- mandar cada mitad por
    // separado, en orden, es exactamente lo que espera KEYEVENTF_UNICODE.
    for unit in texto.encode_utf16() {
        match unit {
            0x000A => send_enter(),  // '\n'
            0x000D => continue,      // '\r' de un \r\n -- el \n que sigue ya manda el Enter
            other => send_unicode_char(other),
        }
        // Margen chico entre teclas -- sin esto, algunas apps (sobre todo
        // las que procesan IME) pierden o reordenan eventos que llegan
        // todos de una ráfaga.
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    Ok(())
}
