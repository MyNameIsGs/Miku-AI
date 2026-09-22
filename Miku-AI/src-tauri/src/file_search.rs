use everything_ipc::wm::{EverythingClient, RequestFlags};
use serde::Serialize;

// Tarea 8.6: búsqueda de archivos por nombre en toda la PC, usando
// Everything (voidtools) -- indexado propio del sistema de archivos,
// resultado casi instantáneo. A diferencia de todo lo demás del proyecto,
// esto SÍ es una dependencia externa real: necesita que Sebastián tenga
// Everything instalado y corriendo (no se puede instalar solo, ni viene
// embebido). Se usa el crate `everything-ipc` -- habla directo por IPC con
// el proceso de Everything ya corriendo (mensajes de ventana de Windows,
// mismo mecanismo que usa su propio cliente de línea de comandos `es.exe`),
// sin necesitar `Everything64.dll` ni ningún otro archivo del SDK oficial
// copiado a mano.
const MAX_RESULTS: u32 = 15;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub path: String,
    pub is_folder: bool,
}

#[tauri::command]
pub fn buscar_archivos(consulta: String) -> Result<Vec<FileSearchResult>, String> {
    if consulta.trim().is_empty() {
        return Err("No se especificó qué buscar.".to_string());
    }

    let client = EverythingClient::new().map_err(|_| {
        "Everything no está instalado o no está corriendo en este momento -- hace falta instalarlo desde voidtools.com y dejarlo corriendo en segundo plano para poder buscar archivos.".to_string()
    })?;

    let list = client
        .query_wait(&consulta)
        .request_flags(RequestFlags::FullPathAndFileName | RequestFlags::Attributes)
        .max_results(MAX_RESULTS)
        .call()
        .map_err(|e| format!("Error buscando en Everything: {e:?}"))?;

    let mut results = Vec::new();
    for item in list.iter() {
        let Some(path) = item.get_string(RequestFlags::FullPathAndFileName) else {
            continue;
        };
        // Bit FILE_ATTRIBUTE_DIRECTORY (0x10) del DWORD de atributos de
        // Win32 -- mismo valor que devuelve GetFileAttributes.
        let is_folder = item
            .get_u32(RequestFlags::Attributes)
            .map(|attrs| attrs & 0x10 != 0)
            .unwrap_or(false);
        results.push(FileSearchResult { path, is_folder });
    }

    Ok(results)
}
