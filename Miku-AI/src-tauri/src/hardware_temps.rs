use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_READ, MEMORY_BASIC_INFORMATION,
    VirtualQuery,
};

// Avisos de sobrecalentamiento (2026-10-26): las temperaturas se leen de la
// memoria compartida de MSI Afterburner ("MAHMSharedMemory"), que ya arranca
// con Windows en esta PC. Leer el sensor del Ryzen directamente pide un
// driver con admin (PawnIO/WinRing0) y Miku corre sin admin; Afterburner ya
// lo hace con su propio driver y deja los valores a la vista de cualquier
// proceso de la sesión, sin permisos.
//
// Formato (MAHM v2.0, verificado contra la memoria real): encabezado de 32
// bytes, después dwNumEntries entradas de dwEntrySize bytes y después
// dwNumGpuEntries entradas de GPU. Cada entrada: 5 textos de 260 bytes
// (nombre, unidad, nombre traducido, unidad traducida, formato), data f32,
// min f32, max f32, flags u32, gpu u32, srcId u32.
const SIGNATURE: u32 = 0x4D41_484D; // "MAHM"
const MAX_PATH: usize = 260;
const SRC_GPU_TEMPERATURE: u32 = 0x00;
const SRC_GPU_TEMP_LIMIT: u32 = 0x70;
const SRC_CPU_TEMPERATURE: u32 = 0x80;
const NO_GPU: u32 = u32::MAX;
// Es una lectura local de memoria, no cuesta nada.
const CHECK_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GpuTemp {
    pub name: String,
    pub temp: f32,
    // Afterburner marca 1 cuando la tarjeta ya está bajando el reloj por
    // temperatura.
    pub temp_limit: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Temperatures {
    pub cpu: Option<f32>,
    pub gpus: Vec<GpuTemp>,
}

fn read_u32(buf: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buf.get(at..at + 4)?.try_into().ok()?))
}

fn read_f32(buf: &[u8], at: usize) -> Option<f32> {
    Some(f32::from_le_bytes(buf.get(at..at + 4)?.try_into().ok()?))
}

fn read_str(buf: &[u8], at: usize) -> String {
    let bytes = buf.get(at..at + MAX_PATH).unwrap_or_default();
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}

fn parse(buf: &[u8]) -> Result<Temperatures, String> {
    let bad = || "La memoria de Afterburner vino con un formato inesperado".to_string();
    if read_u32(buf, 0) != Some(SIGNATURE) {
        // Afterburner pone la firma en 0xDEAD mientras se cierra.
        return Err("MSI Afterburner se está cerrando".to_string());
    }
    let header = read_u32(buf, 8).ok_or_else(bad)? as usize;
    let count = read_u32(buf, 12).ok_or_else(bad)? as usize;
    let size = read_u32(buf, 16).ok_or_else(bad)? as usize;
    let gpu_count = read_u32(buf, 24).ok_or_else(bad)? as usize;
    let gpu_size = read_u32(buf, 28).ok_or_else(bad)? as usize;

    // Nombre de cada GPU (szDevice, el tercer texto de la entrada de GPU).
    let gpu_base = header + count * size;
    let names: Vec<String> = (0..gpu_count)
        .map(|i| read_str(buf, gpu_base + i * gpu_size + 2 * MAX_PATH))
        .collect();

    let mut cpu = None;
    let mut temps: Vec<Option<f32>> = vec![None; gpu_count];
    let mut limits = vec![false; gpu_count];
    for i in 0..count {
        let at = header + i * size;
        let data = read_f32(buf, at + 5 * MAX_PATH).ok_or_else(bad)?;
        let gpu = read_u32(buf, at + 5 * MAX_PATH + 16).ok_or_else(bad)?;
        let src = read_u32(buf, at + 5 * MAX_PATH + 20).ok_or_else(bad)?;
        match src {
            // La temperatura "general" del CPU viene sin GPU asociada; las
            // por núcleo repiten el mismo valor y se ignoran.
            SRC_CPU_TEMPERATURE if gpu == NO_GPU => cpu = Some(data),
            SRC_GPU_TEMPERATURE if (gpu as usize) < gpu_count => temps[gpu as usize] = Some(data),
            SRC_GPU_TEMP_LIMIT if (gpu as usize) < gpu_count => limits[gpu as usize] = data >= 1.0,
            _ => {}
        }
    }

    let gpus = names
        .into_iter()
        .zip(temps)
        .zip(limits)
        .filter_map(|((name, temp), temp_limit)| Some(GpuTemp { name, temp: temp?, temp_limit }))
        .collect();
    Ok(Temperatures { cpu, gpus })
}

// La revisión periódica vive acá y no en el bucle de render del frontend:
// en modo juego la ventana queda con SW_HIDE y ese bucle se detiene, justo
// cuando más se calienta la PC. Los eventos sí le llegan escondida (mismo
// caso que "game-mode-heartbeat"); la decisión de avisar la toma el
// frontend (lib/hardwareTemps.ts). Si Afterburner está cerrado no se manda
// nada y se reintenta en la próxima vuelta.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(CHECK_INTERVAL);
        if let Ok(temps) = temperaturas() {
            let _ = app.emit("temperaturas", temps);
        }
    });
}

#[tauri::command]
pub fn temperaturas() -> Result<Temperatures, String> {
    unsafe {
        let handle = OpenFileMappingW(FILE_MAP_READ.0, false, w!("MAHMSharedMemory")).map_err(|_| {
            "MSI Afterburner no está abierto (Miku lee las temperaturas desde ahí)".to_string()
        })?;
        let view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
        if view.Value.is_null() {
            let _ = CloseHandle(handle);
            return Err("No pude leer la memoria de Afterburner".to_string());
        }
        // El tamaño real de la vista lo da VirtualQuery (MapViewOfFile con
        // largo 0 mapea todo, pero no dice cuánto).
        let mut info = MEMORY_BASIC_INFORMATION::default();
        VirtualQuery(
            Some(view.Value),
            &mut info,
            std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
        );
        let buf = std::slice::from_raw_parts(view.Value as *const u8, info.RegionSize);
        let result = parse(buf);
        let _ = UnmapViewOfFile(view);
        let _ = CloseHandle(handle);
        result
    }
}

#[cfg(test)]
mod tests {
    // Lee la memoria real de Afterburner; solo sirve con él abierto.
    #[test]
    #[ignore]
    fn lee_afterburner() {
        let t = super::temperaturas().expect("Afterburner abierto");
        println!("{}", serde_json::to_string_pretty(&t).unwrap());
        assert!(t.cpu.is_some());
        assert!(t.gpus.iter().any(|g| g.name.contains("5070")));
    }
}
