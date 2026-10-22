use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

// Luces RGB de la PC (2026-10-21, pedido de Sebastián). Cliente propio del
// protocolo del servidor SDK de OpenRGB, sin librerías: OpenRGB ya resolvió
// la parte peligrosa (hablarle al hardware, sobre todo a la RAM por SMBus,
// que necesita un driver de kernel), y Miku solo le dice qué color poner.
//
// Protocolo (Documentation/OpenRGBSDK.md del repo de OpenRGB): TCP al
// puerto 6742, cada paquete = cabecera de 16 bytes ("ORGB", id del
// dispositivo, id del paquete, tamaño de los datos) + datos, todo en
// little-endian. Se habla como mucho la versión 5 del protocolo (OpenRGB
// 1.0rc1, la instalada); el servidor contesta con la que él soporta y se
// usa la menor.
//
// Una conexión por pedido: es localhost y son pocos paquetes, no hace falta
// mantenerla abierta.
//
// Si OpenRGB no está abierto, Miku lo abre ella, minimizado y con el
// servidor prendido (al arrancar la app y al pedir un color): sin eso, al
// reiniciar la PC las luces dejaban de responder. Recién abierto tarda unos
// segundos en detectar los dispositivos (la RAM por SMBus, ~9 s medido en
// la PC de Sebastián), así que se espera a que la lista deje de crecer.

const SERVER: &str = "127.0.0.1:6742";
const MAX_PROTOCOL: u32 = 5;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const REPLY_TIMEOUT: Duration = Duration::from_secs(4);
// Un servidor de protocolo 0 no contesta la versión: se espera poco.
const VERSION_REPLY_TIMEOUT: Duration = Duration::from_millis(800);

// Cuánto se espera a que OpenRGB recién abierto prenda su servidor, y a
// que termine de detectar los dispositivos.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(20);
const DETECTION_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_EVERY: Duration = Duration::from_millis(1000);

const REQUEST_CONTROLLER_COUNT: u32 = 0;
const REQUEST_CONTROLLER_DATA: u32 = 1;
const REQUEST_PROTOCOL_VERSION: u32 = 40;
const SET_CLIENT_NAME: u32 = 50;
const UPDATELEDS: u32 = 1050;
const SETCUSTOMMODE: u32 = 1100;
const UPDATEMODE: u32 = 1101;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RgbZone {
    pub name: String,
    pub leds: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RgbDevice {
    pub index: u32,
    pub name: String,
    pub kind: String,
    pub zones: Vec<RgbZone>,
    pub leds: u16,
    pub modes: Vec<String>,
    pub active_mode: i32,
    // Cada modo tal cual vino del servidor, para devolvérselo en UPDATEMODE.
    #[serde(skip)]
    raw_modes: Vec<Vec<u8>>,
}

// Orden de device_type en RGBController.h de OpenRGB.
fn kind_name(device_type: i32) -> &'static str {
    match device_type {
        0 => "placa madre",
        1 => "RAM",
        2 => "tarjeta de video",
        3 => "refrigeración",
        4 => "tira LED",
        5 => "teclado",
        6 => "mouse",
        7 => "mousepad",
        8 => "audífonos",
        9 => "soporte de audífonos",
        10 => "control",
        11 => "luz",
        12 => "parlante",
        13 => "virtual",
        14 => "almacenamiento",
        15 => "gabinete",
        16 => "micrófono",
        17 => "accesorio",
        18 => "teclado numérico",
        _ => "otro",
    }
}

fn header(device: u32, packet: u32, size: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(16 + size);
    out.extend_from_slice(b"ORGB");
    out.extend_from_slice(&device.to_le_bytes());
    out.extend_from_slice(&packet.to_le_bytes());
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out
}

struct Connection {
    stream: TcpStream,
    protocol: u32,
}

impl Connection {
    async fn open() -> Result<Self, String> {
        let stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(SERVER))
            .await
            .map_err(|_| not_running())?
            .map_err(|_| not_running())?;
        let mut conn = Connection { stream, protocol: 0 };

        conn.send(0, REQUEST_PROTOCOL_VERSION, &MAX_PROTOCOL.to_le_bytes()).await?;
        conn.protocol = match timeout(VERSION_REPLY_TIMEOUT, conn.receive(REQUEST_PROTOCOL_VERSION)).await {
            Ok(Ok(data)) if data.len() >= 4 => {
                u32::from_le_bytes([data[0], data[1], data[2], data[3]]).min(MAX_PROTOCOL)
            }
            _ => 0,
        };

        let mut name = b"Miku".to_vec();
        name.push(0);
        conn.send(0, SET_CLIENT_NAME, &name).await?;
        Ok(conn)
    }

    async fn send(&mut self, device: u32, packet: u32, data: &[u8]) -> Result<(), String> {
        let mut out = header(device, packet, data.len());
        out.extend_from_slice(data);
        self.stream
            .write_all(&out)
            .await
            .map_err(|e| format!("No se pudo hablar con OpenRGB: {e}"))
    }

    // Lee paquetes hasta el que se espera: el servidor también puede mandar
    // avisos por su cuenta (por ejemplo, "cambió la lista de dispositivos").
    async fn receive(&mut self, packet: u32) -> Result<Vec<u8>, String> {
        loop {
            let mut head = [0u8; 16];
            self.stream
                .read_exact(&mut head)
                .await
                .map_err(|e| format!("OpenRGB cortó la conexión: {e}"))?;
            if &head[0..4] != b"ORGB" {
                return Err("OpenRGB respondió algo que no es su protocolo.".into());
            }
            let id = u32::from_le_bytes([head[8], head[9], head[10], head[11]]);
            let size = u32::from_le_bytes([head[12], head[13], head[14], head[15]]) as usize;
            let mut data = vec![0u8; size];
            self.stream
                .read_exact(&mut data)
                .await
                .map_err(|e| format!("OpenRGB cortó la conexión: {e}"))?;
            if id == packet {
                return Ok(data);
            }
        }
    }

    async fn request(&mut self, device: u32, packet: u32, data: &[u8]) -> Result<Vec<u8>, String> {
        self.send(device, packet, data).await?;
        timeout(REPLY_TIMEOUT, self.receive(packet))
            .await
            .map_err(|_| "OpenRGB no respondió a tiempo.".to_string())?
    }

    async fn controller_count(&mut self) -> Result<u32, String> {
        let data = self.request(0, REQUEST_CONTROLLER_COUNT, &[]).await?;
        let mut r = Reader::new(&data);
        r.u32()
    }

    async fn controller(&mut self, index: u32) -> Result<RgbDevice, String> {
        let payload = if self.protocol == 0 { Vec::new() } else { self.protocol.to_le_bytes().to_vec() };
        let data = self.request(index, REQUEST_CONTROLLER_DATA, &payload).await?;
        parse_controller(index, &data, self.protocol)
    }
}

fn not_running() -> String {
    "OpenRGB no responde en su servidor (puerto 6742).".into()
}

fn openrgb_exe() -> Option<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|var| std::env::var(var).ok())
        .map(|dir| PathBuf::from(dir).join("OpenRGB").join("OpenRGB.exe"))
        .find(|path| path.exists())
}

// Abre OpenRGB independiente de Miku: sin heredar NINGÚN handle (con
// std::process::Command, Rust pasa todos los heredables aunque la salida
// vaya a null, y quien leía la salida de Miku se quedaba esperando a que
// OpenRGB se cerrara), sin consola, y sigue abierto si Miku se cierra.
fn launch_detached(exe: &std::path::Path) -> Result<(), String> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        CreateProcessW, CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS, PROCESS_INFORMATION, STARTUPINFOW,
    };
    let mut command_line: Vec<u16> = format!("\"{}\" --server --startminimized", exe.display())
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let startup = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, ..Default::default() };
    let mut info = PROCESS_INFORMATION::default();
    unsafe {
        CreateProcessW(
            PCWSTR::null(),
            Some(PWSTR(command_line.as_mut_ptr())),
            None,
            None,
            false,
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            None,
            PCWSTR::null(),
            &startup,
            &mut info,
        )
        .map_err(|e| format!("No se pudo abrir OpenRGB: {e}"))?;
        let _ = CloseHandle(info.hProcess);
        let _ = CloseHandle(info.hThread);
    }
    Ok(())
}

async fn server_up() -> bool {
    matches!(timeout(Duration::from_millis(500), TcpStream::connect(SERVER)).await, Ok(Ok(_)))
}

// Deja el servidor de OpenRGB escuchando. Devuelve true si lo tuvo que
// abrir recién (entonces todavía puede estar detectando dispositivos).
pub async fn ensure_server() -> Result<bool, String> {
    if server_up().await {
        return Ok(false);
    }
    // Abierto a mano sin el servidor: abrir otro se pelearía con ese por
    // los mismos dispositivos.
    if !crate::window_control::find_pids_by_process_name("OpenRGB.exe").is_empty() {
        return Err("OpenRGB está abierto pero sin su servidor: en OpenRGB, pestaña \"SDK Server\", botón \"Start Server\" (o ciérralo y lo abro yo).".into());
    }
    let exe = openrgb_exe().ok_or("No encontré OpenRGB instalado.")?;
    launch_detached(&exe)?;
    let started = tokio::time::Instant::now();
    while started.elapsed() < LAUNCH_TIMEOUT {
        tokio::time::sleep(POLL_EVERY).await;
        if server_up().await {
            return Ok(true);
        }
    }
    Err("Abrí OpenRGB pero su servidor no arrancó.".into())
}

// Recién abierto, los dispositivos van apareciendo mientras detecta: se
// espera a que la cantidad deje de cambiar (dos revisiones iguales y más de
// cero).
async fn wait_for_detection(conn: &mut Connection) -> Result<(), String> {
    let started = tokio::time::Instant::now();
    let mut last = conn.controller_count().await?;
    while started.elapsed() < DETECTION_TIMEOUT {
        tokio::time::sleep(POLL_EVERY * 2).await;
        let count = conn.controller_count().await?;
        if count > 0 && count == last {
            return Ok(());
        }
        last = count;
    }
    Ok(())
}

// Conexión lista para usar: abre OpenRGB si hace falta y, si lo acaba de
// abrir, espera a que detecte.
async fn connect() -> Result<Connection, String> {
    let launched = ensure_server().await?;
    let mut conn = Connection::open().await?;
    if launched {
        wait_for_detection(&mut conn).await?;
    }
    Ok(conn)
}

// Lector secuencial de los datos de un controlador.
struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Reader { data, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.pos + n > self.data.len() {
            return Err("Los datos de OpenRGB vinieron cortados.".into());
        }
        let slice = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(slice)
    }

    fn u16(&mut self) -> Result<u16, String> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    fn u32(&mut self) -> Result<u32, String> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn i32(&mut self) -> Result<i32, String> {
        Ok(self.u32()? as i32)
    }

    // Texto con largo de 2 bytes delante; el largo incluye el 0 del final.
    fn string(&mut self) -> Result<String, String> {
        let len = self.u16()? as usize;
        let bytes = self.take(len)?;
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        Ok(String::from_utf8_lossy(&bytes[..end]).trim().to_string())
    }

    fn skip(&mut self, n: usize) -> Result<(), String> {
        self.take(n).map(|_| ())
    }
}

// Datos de un controlador hasta la lista de LEDs (lo que viene después no
// hace falta). Campos según la versión del protocolo, ver OpenRGBSDK.md.
fn parse_controller(index: u32, data: &[u8], protocol: u32) -> Result<RgbDevice, String> {
    let mut r = Reader::new(data);
    r.u32()?; // data_size
    let device_type = r.i32()?;
    let name = r.string()?;
    if protocol >= 1 {
        r.string()?; // fabricante
    }
    r.string()?; // descripción
    r.string()?; // versión
    r.string()?; // serie
    r.string()?; // ubicación

    let num_modes = r.u16()?;
    let active_mode = r.i32()?;
    let mut modes = Vec::with_capacity(num_modes as usize);
    let mut raw_modes = Vec::with_capacity(num_modes as usize);
    for _ in 0..num_modes {
        let mode_start = r.pos;
        modes.push(r.string()?);
        r.i32()?; // mode_value
        r.u32()?; // flags
        r.skip(8)?; // velocidad mín/máx
        if protocol >= 3 {
            r.skip(8)?; // brillo mín/máx
        }
        r.skip(8)?; // colores mín/máx
        r.u32()?; // velocidad
        if protocol >= 3 {
            r.u32()?; // brillo
        }
        r.u32()?; // dirección
        r.u32()?; // color_mode
        let colors = r.u16()? as usize;
        r.skip(colors * 4)?;
        raw_modes.push(data[mode_start..r.pos].to_vec());
    }

    let num_zones = r.u16()?;
    let mut zones = Vec::with_capacity(num_zones as usize);
    for _ in 0..num_zones {
        let zone_name = r.string()?;
        r.i32()?; // tipo
        r.skip(8)?; // LEDs mín/máx
        let leds = r.u32()?;
        let matrix_len = r.u16()? as usize;
        r.skip(matrix_len)?;
        if protocol >= 4 {
            let segments = r.u16()?;
            for _ in 0..segments {
                r.string()?;
                r.skip(12)?; // tipo, inicio, cantidad
            }
        }
        if protocol >= 5 {
            r.u32()?; // zone_flags
        }
        zones.push(RgbZone { name: zone_name, leds });
    }

    let leds = r.u16()?;
    Ok(RgbDevice { index, name, kind: kind_name(device_type).into(), zones, leds, modes, active_mode, raw_modes })
}

async fn all_devices(conn: &mut Connection) -> Result<Vec<RgbDevice>, String> {
    let count = conn.controller_count().await?;
    let mut devices = Vec::with_capacity(count as usize);
    for index in 0..count {
        devices.push(conn.controller(index).await?);
    }
    Ok(devices)
}

#[tauri::command]
pub async fn rgb_listar() -> Result<Vec<RgbDevice>, String> {
    let mut conn = connect().await?;
    all_devices(&mut conn).await
}

// Pone todos los LEDs de los dispositivos elegidos (por índice; vacío =
// todos) en un color fijo. Primero el modo "directo", que es el que acepta
// colores LED por LED. Devuelve los nombres de los que cambió.
//
// SETCUSTOMMODE solo no alcanza: en la RAM (ENE) cambia el modo que OpenRGB
// cree activo pero no se lo manda al hardware, que seguía con su efecto
// guardado (Rainbow) e ignoraba los colores -- medido en la PC de
// Sebastián; el micrófono, que solo tiene "Direct", sí cambiaba. Por eso
// además se manda UPDATEMODE con el modo Direct, como hace la ventana de
// OpenRGB al elegir un modo.
#[tauri::command]
pub async fn rgb_poner_color(r: u8, g: u8, b: u8, dispositivos: Vec<u32>) -> Result<Vec<String>, String> {
    let mut conn = connect().await?;
    let devices = all_devices(&mut conn).await?;
    let mut changed = Vec::new();
    for device in devices.iter().filter(|d| dispositivos.is_empty() || dispositivos.contains(&d.index)) {
        if device.leds == 0 {
            continue;
        }
        conn.send(device.index, SETCUSTOMMODE, &[]).await?;
        if let Some(direct) = device.modes.iter().position(|m| m.eq_ignore_ascii_case("direct")) {
            let mode = &device.raw_modes[direct];
            let size = 4 + 4 + mode.len();
            let mut payload = Vec::with_capacity(size);
            payload.extend_from_slice(&(size as u32).to_le_bytes());
            payload.extend_from_slice(&(direct as i32).to_le_bytes());
            payload.extend_from_slice(mode);
            conn.send(device.index, UPDATEMODE, &payload).await?;
        }
        // data_size (incluye sus propios 4 bytes) + cantidad + un RGBColor
        // por LED: 0x00BBGGRR, o sea bytes R, G, B, 0.
        let size = 4 + 2 + 4 * device.leds as usize;
        let mut payload = Vec::with_capacity(size);
        payload.extend_from_slice(&(size as u32).to_le_bytes());
        payload.extend_from_slice(&device.leds.to_le_bytes());
        for _ in 0..device.leds {
            payload.extend_from_slice(&[r, g, b, 0]);
        }
        conn.send(device.index, UPDATELEDS, &payload).await?;
        changed.push(device.name.clone());
    }
    // Lo que se manda sin respuesta se va antes de cerrar la conexión.
    let _ = conn.stream.flush().await;
    Ok(changed)
}

// Contra un OpenRGB de verdad abierto con --server:
// cargo test --lib openrgb -- --ignored --nocapture
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn lista_los_dispositivos_reales() {
        let mut conn = Connection::open().await.expect("OpenRGB abierto");
        println!("protocolo {}", conn.protocol);
        for d in all_devices(&mut conn).await.expect("lista") {
            println!("{} [{}] {} LEDs, modo activo {:?}, zonas {:?}, modos {:?}", d.name, d.kind, d.leds, d.modes.get(d.active_mode as usize),
                d.zones.iter().map(|z| (&z.name, z.leds)).collect::<Vec<_>>(), d.modes);
        }
    }

    #[tokio::test]
    #[ignore]
    async fn pone_el_turquesa_de_miku() {
        let changed = rgb_poner_color(0x39, 0xC5, 0xBB, vec![]).await.expect("color");
        println!("cambiados: {changed:?}");
    }

    // Diagnóstico de la RAM: 15 s en rojo reescribiéndolo cada 100 ms (si
    // otro programa pelea, se ve rojo parpadeando) y 15 s en azul escrito
    // una sola vez (si otro programa pelea, el azul dura un instante).
    #[tokio::test]
    #[ignore]
    async fn prueba_de_la_ram() {
        let ram: Vec<u32> = rgb_listar().await.expect("lista").iter()
            .filter(|d| d.kind == "RAM").map(|d| d.index).collect();
        println!("RAM: {ram:?}");
        let started = tokio::time::Instant::now();
        while started.elapsed() < Duration::from_secs(15) {
            rgb_poner_color(255, 0, 0, ram.clone()).await.expect("rojo");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        rgb_poner_color(0, 0, 255, ram.clone()).await.expect("azul");
        tokio::time::sleep(Duration::from_secs(15)).await;
        println!("listo");
    }

    // El caso que fallaba: la RAM en un efecto de hardware (Rainbow) y
    // después un color fijo. Debe verse arcoíris 5 s, rojo 10 s y azul 10 s.
    #[tokio::test]
    #[ignore]
    async fn desde_rainbow() {
        let mut conn = connect().await.expect("conexión");
        for d in all_devices(&mut conn).await.expect("lista").iter().filter(|d| d.kind == "RAM") {
            let idx = d.modes.iter().position(|m| m == "Rainbow").expect("modo Rainbow");
            let mode = &d.raw_modes[idx];
            let size = 8 + mode.len();
            let mut payload = (size as u32).to_le_bytes().to_vec();
            payload.extend_from_slice(&(idx as i32).to_le_bytes());
            payload.extend_from_slice(mode);
            conn.send(d.index, UPDATEMODE, &payload).await.expect("rainbow");
        }
        let _ = conn.stream.flush().await;
        tokio::time::sleep(Duration::from_secs(5)).await;
        println!("cambiados: {:?}", rgb_poner_color(255, 0, 0, vec![0, 1]).await.expect("rojo"));
        tokio::time::sleep(Duration::from_secs(10)).await;
        rgb_poner_color(0, 0, 255, vec![0, 1]).await.expect("azul");
        tokio::time::sleep(Duration::from_secs(10)).await;
        println!("listo");
    }
}
