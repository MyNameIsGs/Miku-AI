use base64::Engine;
use serde::Serialize;
use xcap::Monitor;

// Tarea 6.6: captura monitores conectados -- reportado que Miku no veía el
// segundo monitor con la primera versión (que solo capturaba el
// principal). Cada uno se devuelve por separado (con su propia etiqueta)
// en vez de pegarlos en una sola imagen, para no perder resolución ni
// introducir un armado manual de layout que además no sabe si los
// monitores están en horizontal, vertical, o con distinta resolución
// entre sí.
//
// `indices` (1-based, mismo número que en la etiqueta "Monitor N") permite
// capturar solo algunos en vez de todos -- cada imagen de más son varios
// cientos/miles de tokens de más en la respuesta, así que el llamador
// (ver lib/tools/verPantalla.ts) por defecto solo pide el principal y deja
// "todos" para cuando de verdad hace falta.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCapture {
    pub label: String,
    pub data_url: String,
}

fn encode_png_data_url(image: &image::RgbaImage) -> Result<String, String> {
    let mut buffer = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png)
        .map_err(|e| format!("Error codificando la captura: {e}"))?;
    let base64_data = base64::engine::general_purpose::STANDARD.encode(&buffer);
    Ok(format!("data:image/png;base64,{}", base64_data))
}

#[tauri::command]
pub fn capture_screens(indices: Option<Vec<usize>>) -> Result<Vec<ScreenCapture>, String> {
    let monitors = Monitor::all().map_err(|e| format!("Error accediendo a los monitores: {e}"))?;
    if monitors.is_empty() {
        return Err("No se encontró ningún monitor".to_string());
    }

    let wanted: Vec<usize> = match indices {
        Some(v) if !v.is_empty() => v,
        _ => (1..=monitors.len()).collect(),
    };

    let mut captures = Vec::new();
    for i in wanted {
        let Some(monitor) = monitors.get(i.saturating_sub(1)) else {
            continue;
        };

        let image = monitor
            .capture_image()
            .map_err(|e| format!("Error capturando el monitor {}: {}", i, e))?;
        let data_url = encode_png_data_url(&image)?;

        let is_primary = monitor.is_primary().unwrap_or(false);
        let label = format!("Monitor {}{}", i, if is_primary { " (principal)" } else { "" });

        captures.push(ScreenCapture { label, data_url });
    }

    if captures.is_empty() {
        return Err(format!(
            "Ninguno de los monitores pedidos existe (hay {} conectados)",
            monitors.len()
        ));
    }

    Ok(captures)
}
