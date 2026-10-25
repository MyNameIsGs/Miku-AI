use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;

// Las tiras de luz del teclado AULA F87 Pro (2026-10-25, pedido de
// Sebastián): la de arriba (debajo del bloque DEL/END/PgDn, "Light Strip" en
// el manual) y las dos de abajo, a izquierda y derecha ("Sidelight"). OpenRGB
// solo maneja las teclas; las tiras tienen modos y colores propios del
// teclado que se guardan en su configuración.
//
// Cómo se encontró (capturando la app oficial con USBPcap y leyendo la
// configuración antes y después de cada atajo Fn): la configuración es un
// reporte feature 0x06 de 520 bytes en la interfaz MI_01 COL06 (página
// 0xFF00). Se lee mandando `06 84 00 00 01 00 80 00` y pidiendo el reporte
// (vuelve `06 84 ...` + un bloque de 128 bytes que termina en `5a a5`); se
// escribe mandando `06 84` y después `06 04 00 00 01 00 80 00` + el bloque.
// Dentro del bloque:
//   [18] modo de las de abajo  [19] color  [20] brillo  [21] velocidad
//   [28] modo de la de arriba  [29] color
// Modos: 0 apagadas, 1 arcoíris, 2 otro arcoíris, 3 sólido, 4 respiración.
// Colores: 0 rojo, 1 verde, 2 azul, 3 amarillo, 4 rosa, 5 azul claro, 6 blanco.
//
// OJO, medido en vivo: un valor fuera de rango (el modo 5 a 9 en [28]) hace
// que el teclado vuelva entero a su configuración de fábrica. Por eso se
// parte siempre de la configuración leída del teclado, se cambian solo
// estos bytes y se controlan los rangos antes de escribir.
//
// Escribir la configuración reinicia toda la iluminación del teclado: las
// tiras y las teclas parpadean, y las teclas salen del modo directo de
// OpenRGB. Después de escribir se le avisa al motor (lights_engine) para que
// vuelva a poner el teclado en directo. Por eso solo se escribe si algo
// cambió de verdad.

const HID_INTERFACE: windows::core::GUID = windows::core::GUID::from_u128(0x4d1e55b2_f16f_11cf_88cb_001111000030);
// Teclado AULA F87 Pro (SinoWealth), interfaz de luces.
const DEVICE_MATCH: &str = "vid_258a&pid_010c&mi_01&col06";
const REPORT_LEN: usize = 520;
const BLOCK: usize = 8;
const READ_REQUEST: [u8; 8] = [0x06, 0x84, 0x00, 0x00, 0x01, 0x00, 0x80, 0x00];
const WRITE_HEADER: [u8; 8] = [0x06, 0x04, 0x00, 0x00, 0x01, 0x00, 0x80, 0x00];

const BOTTOM_MODE: usize = 18;
const BOTTOM_COLOR: usize = 19;
const BOTTOM_BRIGHTNESS: usize = 20;
const BOTTOM_SPEED: usize = 21;
const TOP_MODE: usize = 28;
const TOP_COLOR: usize = 29;

pub const MAX_MODE: u8 = 4;
pub const MAX_COLOR: u8 = 6;
// Lo que recorren Fn + Alt derecho (brillo, 5 niveles) y Fn + Ctrl derecho
// (velocidad: lento, medio, rápido); medido en vivo, los dos empiezan en 0.
pub const MAX_BRIGHTNESS: u8 = 4;
pub const MAX_SPEED: u8 = 2;

#[derive(Deserialize, Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Bottom {
    pub mode: u8,
    pub color: u8,
    pub brightness: u8,
    pub speed: u8,
}

#[derive(Deserialize, Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Top {
    pub mode: u8,
    pub color: u8,
}

#[derive(Deserialize, Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Strips {
    pub bottom: Bottom,
    pub top: Top,
}

// Un pedido a la vez: leer y escribir son tres reportes seguidos y no se
// pueden mezclar con los de otro pedido.
static BUSY: Mutex<()> = Mutex::new(());

fn device_path() -> Result<Vec<u16>, String> {
    use windows::Win32::Devices::DeviceAndDriverInstallation::{
        CM_Get_Device_Interface_ListW, CM_Get_Device_Interface_List_SizeW, CM_GET_DEVICE_INTERFACE_LIST_PRESENT, CR_SUCCESS,
    };
    unsafe {
        let mut len = 0u32;
        if CM_Get_Device_Interface_List_SizeW(&mut len, &HID_INTERFACE, None, CM_GET_DEVICE_INTERFACE_LIST_PRESENT) != CR_SUCCESS {
            return Err("No se pudo pedir la lista de dispositivos HID.".into());
        }
        let mut buffer = vec![0u16; len as usize];
        if CM_Get_Device_Interface_ListW(&HID_INTERFACE, None, &mut buffer, CM_GET_DEVICE_INTERFACE_LIST_PRESENT) != CR_SUCCESS {
            return Err("No se pudo leer la lista de dispositivos HID.".into());
        }
        // Lista de rutas separadas por \0 y terminada en \0\0.
        for path in buffer.split(|&c| c == 0).filter(|p| !p.is_empty()) {
            if String::from_utf16_lossy(path).to_lowercase().contains(DEVICE_MATCH) {
                let mut out = path.to_vec();
                out.push(0);
                return Ok(out);
            }
        }
    }
    Err("No encontré el teclado AULA F87 Pro (¿está conectado por cable?).".into())
}

struct Device(windows::Win32::Foundation::HANDLE);

impl Drop for Device {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

impl Device {
    fn open() -> Result<Self, String> {
        use windows::Win32::Storage::FileSystem::{
            CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        };
        let path = device_path()?;
        let handle = unsafe {
            CreateFileW(
                windows::core::PCWSTR(path.as_ptr()),
                (FILE_GENERIC_READ | FILE_GENERIC_WRITE).0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                None,
            )
        }
        .map_err(|e| format!("No se pudo abrir el teclado: {e}"))?;
        Ok(Device(handle))
    }

    fn set(&self, report: &[u8]) -> Result<(), String> {
        use windows::Win32::Devices::HumanInterfaceDevice::HidD_SetFeature;
        let ok = unsafe { HidD_SetFeature(self.0, report.as_ptr() as *const _, report.len() as u32) };
        if ok {
            Ok(())
        } else {
            Err(format!("El teclado no aceptó el reporte {:02x} {:02x}.", report[0], report[1]))
        }
    }

    // A veces (medido: una lectura de cada 15, más o menos, con el servicio de
    // OpenRGB andando) vuelve otro bloque en vez de la configuración: se
    // reintenta.
    fn read_config(&self) -> Result<[u8; REPORT_LEN], String> {
        let mut last = Err(String::new());
        for _ in 0..4 {
            last = self.read_config_once();
            if last.is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(60));
        }
        last
    }

    fn read_config_once(&self) -> Result<[u8; REPORT_LEN], String> {
        use windows::Win32::Devices::HumanInterfaceDevice::HidD_GetFeature;
        let mut request = [0u8; REPORT_LEN];
        request[..READ_REQUEST.len()].copy_from_slice(&READ_REQUEST);
        self.set(&request)?;
        std::thread::sleep(Duration::from_millis(40));
        let mut reply = [0u8; REPORT_LEN];
        reply[0] = 0x06;
        let ok = unsafe { HidD_GetFeature(self.0, reply.as_mut_ptr() as *mut _, REPORT_LEN as u32) };
        if !ok {
            return Err("No se pudo leer la configuración del teclado.".into());
        }
        check_config(&reply)?;
        Ok(reply)
    }
}

// Que lo leído sea de verdad la configuración (y no, por ejemplo, el último
// reporte de colores que mandó OpenRGB): cabecera 06 84 y el bloque cerrado
// con 5a a5.
fn check_config(reply: &[u8; REPORT_LEN]) -> Result<(), String> {
    if reply[..2] != [0x06, 0x84] || reply[BLOCK + 126..BLOCK + 128] != [0x5a, 0xa5] {
        return Err("La configuración que devolvió el teclado no tiene la forma esperada.".into());
    }
    Ok(())
}

fn parse(config: &[u8; REPORT_LEN]) -> Strips {
    let b = |i: usize| config[BLOCK + i];
    Strips {
        bottom: Bottom { mode: b(BOTTOM_MODE), color: b(BOTTOM_COLOR), brightness: b(BOTTOM_BRIGHTNESS), speed: b(BOTTOM_SPEED) },
        top: Top { mode: b(TOP_MODE), color: b(TOP_COLOR) },
    }
}

fn validate(s: &Strips) -> Result<(), String> {
    let ok = s.bottom.mode <= MAX_MODE
        && s.top.mode <= MAX_MODE
        && s.bottom.color <= MAX_COLOR
        && s.top.color <= MAX_COLOR
        && s.bottom.brightness <= MAX_BRIGHTNESS
        && s.bottom.speed <= MAX_SPEED;
    if ok {
        Ok(())
    } else {
        Err("Valor fuera de rango para las tiras del teclado (no se mandó nada).".into())
    }
}

// El reporte de escritura: la configuración leída con las tiras cambiadas.
fn write_report(config: &[u8; REPORT_LEN], s: &Strips) -> [u8; REPORT_LEN] {
    let mut out = *config;
    out[..WRITE_HEADER.len()].copy_from_slice(&WRITE_HEADER);
    for (i, v) in [
        (BOTTOM_MODE, s.bottom.mode),
        (BOTTOM_COLOR, s.bottom.color),
        (BOTTOM_BRIGHTNESS, s.bottom.brightness),
        (BOTTOM_SPEED, s.bottom.speed),
        (TOP_MODE, s.top.mode),
        (TOP_COLOR, s.top.color),
    ] {
        out[BLOCK + i] = v;
    }
    out
}

// El motor deja de mandarle colores al teclado un momento (ver
// lights_engine::hold_device) y se espera a que OpenRGB termine lo que
// tenía en camino.
fn quiet_keyboard() {
    crate::lights_engine::hold_device("aula", Duration::from_millis(2500));
    std::thread::sleep(Duration::from_millis(150));
}

fn read_blocking() -> Result<Strips, String> {
    let _guard = BUSY.lock().unwrap();
    quiet_keyboard();
    let result = Device::open().and_then(|device| device.read_config()).map(|c| parse(&c));
    crate::lights_engine::release_device();
    result
}

// Devuelve si escribió (false: el teclado ya estaba así).
fn apply_blocking(s: Strips) -> Result<bool, String> {
    validate(&s)?;
    let _guard = BUSY.lock().unwrap();
    quiet_keyboard();
    let result = (|| {
        let device = Device::open()?;
        let config = device.read_config()?;
        if parse(&config) == s {
            return Ok(false);
        }
        let mut request = [0u8; REPORT_LEN];
        request[..READ_REQUEST.len()].copy_from_slice(&READ_REQUEST);
        device.set(&request)?;
        std::thread::sleep(Duration::from_millis(80));
        device.set(&write_report(&config, &s))?;
        Ok(true)
    })();
    // Si escribió, el teclado sale del directo: el motor lo vuelve a poner
    // (teclado_tiras_poner) y recién ahí le manda colores.
    crate::lights_engine::release_device();
    result
}

#[tauri::command]
pub async fn teclado_tiras_leer() -> Result<Strips, String> {
    tauri::async_runtime::spawn_blocking(read_blocking).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn teclado_tiras_poner(tiras: Strips) -> Result<bool, String> {
    let wrote = tauri::async_runtime::spawn_blocking(move || apply_blocking(tiras)).await.map_err(|e| e.to_string())?;
    if let Err(e) = &wrote {
        eprintln!("[LUCES] Tiras del teclado: {e}");
    }
    let wrote = wrote?;
    if wrote {
        // Que el teclado termine de reiniciar sus luces antes de volver a
        // ponerlo en directo.
        tokio::time::sleep(Duration::from_millis(300)).await;
        crate::lights_engine::redo_direct("aula");
    }
    Ok(wrote)
}

#[cfg(test)]
mod tests {
    use super::*;

    // La configuración que se leyó del teclado de Sebastián (2026-10-25),
    // con las tiras de abajo en respiración amarilla.
    fn sample() -> [u8; REPORT_LEN] {
        let mut c = [0u8; REPORT_LEN];
        let head = [
            0x06, 0x84, 0x00, 0x00, 0x01, 0x00, 0x80, 0x00, // cabecera
            0x00, 0x03, 0x03, 0x01, 0x00, 0x00, 0x04, 0x04, 0x07, 0x00, 0x03, 0x20, 0x01, 0x00, 0x00, 0x00, //
            0x00, 0x00, 0x04, 0x03, 0x02, 0x02, 0x00, 0xff, 0x0a, 0x00, 0x00, 0x00, 0x04, 0x06, 0x04, 0x01,
        ];
        c[..head.len()].copy_from_slice(&head);
        c[BLOCK + 126] = 0x5a;
        c[BLOCK + 127] = 0xa5;
        c
    }

    #[test]
    fn lee_las_tiras_de_la_configuracion() {
        let s = parse(&sample());
        assert_eq!(s.bottom, Bottom { mode: 4, color: 3, brightness: 2, speed: 2 });
        assert_eq!(s.top, Top { mode: 4, color: 6 });
        assert!(check_config(&sample()).is_ok());
    }

    #[test]
    fn escribir_cambia_solo_los_bytes_de_las_tiras() {
        let config = sample();
        let s = Strips { bottom: Bottom { mode: 3, color: 0, brightness: 2, speed: 2 }, top: Top { mode: 1, color: 6 } };
        let out = write_report(&config, &s);
        assert_eq!(out[..8], WRITE_HEADER);
        let changed: Vec<usize> = (8..REPORT_LEN).filter(|&i| out[i] != config[i]).map(|i| i - BLOCK).collect();
        assert_eq!(changed, vec![BOTTOM_MODE, BOTTOM_COLOR, TOP_MODE]);
        assert_eq!(parse(&{ let mut r = out; r[1] = 0x84; r }), s);
    }

    // Solo lee (no cambia nada): `cargo test --lib lee_el_teclado_real -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn lee_el_teclado_real() {
        println!("{:?}", read_blocking());
    }

    #[test]
    fn rechaza_valores_fuera_de_rango() {
        let mut s = parse(&sample());
        assert!(validate(&s).is_ok());
        s.top.mode = 5;
        assert!(validate(&s).is_err());
        s.top.mode = 4;
        s.bottom.speed = 3;
        assert!(validate(&s).is_err());
        let mut bad = sample();
        bad[BLOCK + 127] = 0;
        assert!(check_config(&bad).is_err());
    }
}
