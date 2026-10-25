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
// Medido: con el servidor tranquilo contesta en menos de 1 ms; pero
// mientras el teclado AULA se reinicia (al escribirle las tiras, ver
// keyboard_strips.rs) OpenRGB puede tardar varios segundos en contestar
// cualquier cosa. Antes eran 4 s y a veces saltaba el aviso.
const REPLY_TIMEOUT: Duration = Duration::from_secs(8);
// Un servidor de protocolo 0 no contesta la versión: se espera poco. Pero
// no tan poco: si el servidor está ocupado y la respuesta llega tarde, se
// hablaría el protocolo 0 con un servidor que espera el 5.
const VERSION_REPLY_TIMEOUT: Duration = Duration::from_millis(2500);

// Cuánto se espera a que OpenRGB recién abierto prenda su servidor, y a
// que termine de detectar los dispositivos.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(20);
const DETECTION_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_EVERY: Duration = Duration::from_millis(1000);

const REQUEST_CONTROLLER_COUNT: u32 = 0;
const REQUEST_CONTROLLER_DATA: u32 = 1;
const REQUEST_PROTOCOL_VERSION: u32 = 40;
const SET_CLIENT_NAME: u32 = 50;
const RESIZEZONE: u32 = 1000;
const UPDATELEDS: u32 = 1050;
pub(crate) const UPDATEZONELEDS: u32 = 1051;
const SETCUSTOMMODE: u32 = 1100;
const UPDATEMODE: u32 = 1101;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RgbZone {
    pub index: u32,
    pub name: String,
    pub leds: u32,
    // Rango de LEDs que acepta. En los conectores ARGB de la placa es
    // distinto (0 hasta lo que soporte): la placa no sabe qué hay enchufado
    // y hay que decirle cuántos LEDs tiene (RESIZEZONE).
    pub leds_min: u32,
    pub leds_max: u32,
    // Dónde empieza esta zona dentro de la lista de LEDs del dispositivo.
    pub start: u32,
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
    pub(crate) raw_modes: Vec<Vec<u8>>,
    // Nombre de cada LED (por ejemplo "Key: Escape"), en el orden del
    // dispositivo.
    #[serde(skip)]
    pub(crate) led_names: Vec<String>,
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

pub(crate) struct Connection {
    pub(crate) stream: TcpStream,
    protocol: u32,
}

impl Connection {
    pub(crate) async fn open() -> Result<Self, String> {
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

    pub(crate) async fn send(&mut self, device: u32, packet: u32, data: &[u8]) -> Result<(), String> {
        let mut out = header(device, packet, data.len());
        out.extend_from_slice(data);
        self.stream
            .write_all(&out)
            .await
            .map_err(|e| format!("No se pudo hablar con OpenRGB: {e}"))
    }

    // Lee paquetes hasta el que se espera: el servidor también puede mandar
    // avisos por su cuenta (por ejemplo, "cambió la lista de dispositivos").
    // `device`: de qué dispositivo tiene que ser la respuesta. Si un pedido
    // anterior se dio por perdido y su respuesta llega tarde, no se la
    // confunde con la de este (antes pasaba: la lista quedaba con los datos
    // de un dispositivo en el lugar de otro).
    async fn receive(&mut self, packet: u32) -> Result<Vec<u8>, String> {
        self.receive_from(None, packet).await
    }

    async fn receive_from(&mut self, device: Option<u32>, packet: u32) -> Result<Vec<u8>, String> {
        loop {
            let mut head = [0u8; 16];
            self.stream
                .read_exact(&mut head)
                .await
                .map_err(|e| format!("OpenRGB cortó la conexión: {e}"))?;
            if &head[0..4] != b"ORGB" {
                return Err("OpenRGB respondió algo que no es su protocolo.".into());
            }
            let from = u32::from_le_bytes([head[4], head[5], head[6], head[7]]);
            let id = u32::from_le_bytes([head[8], head[9], head[10], head[11]]);
            let size = u32::from_le_bytes([head[12], head[13], head[14], head[15]]) as usize;
            let mut data = vec![0u8; size];
            self.stream
                .read_exact(&mut data)
                .await
                .map_err(|e| format!("OpenRGB cortó la conexión: {e}"))?;
            if id == packet && device.is_none_or(|d| d == from) {
                return Ok(data);
            }
        }
    }

    async fn request(&mut self, device: u32, packet: u32, data: &[u8]) -> Result<Vec<u8>, String> {
        self.send(device, packet, data).await?;
        timeout(REPLY_TIMEOUT, self.receive_from(Some(device), packet))
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
    // OpenRGB 1.x se instala también como servicio de Windows, que corre
    // como sistema y es el único con permiso para PawnIO (la RAM por
    // SMBus). Si está instalado se lo espera (al prender la PC tarda en
    // arrancar) y nunca se abre otro OpenRGB: uno sin administrador no ve la
    // RAM y muestra el aviso de "I2C/SMBus interfaces failed to initialize".
    if openrgb_service_installed() {
        if wait_for_server().await {
            return Ok(true);
        }
        return Err("El servicio de OpenRGB no está corriendo. Se puede arrancar desde Servicios de Windows (\"OpenRGB\"), o reiniciando la PC.".into());
    }
    // Abierto a mano sin el servidor: abrir otro se pelearía con ese por
    // los mismos dispositivos.
    if !crate::window_control::find_pids_by_process_name("OpenRGB.exe").is_empty() {
        return Err("OpenRGB está abierto pero sin su servidor: en OpenRGB, pestaña \"SDK Server\", botón \"Start Server\" (o ciérralo y lo abro yo).".into());
    }
    let exe = openrgb_exe().ok_or("No encontré OpenRGB instalado.")?;
    launch_detached(&exe)?;
    if wait_for_server().await {
        return Ok(true);
    }
    Err("Abrí OpenRGB pero su servidor no arrancó.".into())
}

async fn wait_for_server() -> bool {
    let started = tokio::time::Instant::now();
    while started.elapsed() < LAUNCH_TIMEOUT {
        tokio::time::sleep(POLL_EVERY).await;
        if server_up().await {
            return true;
        }
    }
    false
}

// "sc query OpenRGB" sale con 0 si el servicio existe (corriendo o no).
fn openrgb_service_installed() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("sc.exe")
        .args(["query", "OpenRGB"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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
pub(crate) async fn connect() -> Result<Connection, String> {
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
    let mut start = 0;
    for zone_index in 0..num_zones as u32 {
        let zone_name = r.string()?;
        r.i32()?; // tipo
        let leds_min = r.u32()?;
        let leds_max = r.u32()?;
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
        zones.push(RgbZone { index: zone_index, name: zone_name, leds, leds_min, leds_max, start });
        start += leds;
    }

    let leds = r.u16()?;
    let mut led_names = Vec::with_capacity(leds as usize);
    for _ in 0..leds {
        led_names.push(r.string()?);
        if protocol < 6 {
            r.u32()?; // led_value
        }
    }
    Ok(RgbDevice { index, name, kind: kind_name(device_type).into(), zones, leds, modes, active_mode, raw_modes, led_names })
}

pub(crate) async fn all_devices(conn: &mut Connection) -> Result<Vec<RgbDevice>, String> {
    let count = conn.controller_count().await?;
    let mut devices = Vec::with_capacity(count as usize);
    for index in 0..count {
        devices.push(conn.controller(index).await?);
    }
    Ok(devices)
}

// Deja el dispositivo en modo directo, el que acepta colores LED por LED.
//
// SETCUSTOMMODE solo no alcanza: en la RAM (ENE) cambia el modo que OpenRGB
// cree activo pero no se lo manda al hardware, que seguía con su efecto
// guardado (Rainbow) e ignoraba los colores -- medido en la PC de
// Sebastián; el micrófono, que solo tiene "Direct", sí cambiaba. Por eso
// además se manda UPDATEMODE con el modo Direct, como hace la ventana de
// OpenRGB al elegir un modo.
pub(crate) async fn set_direct(conn: &mut Connection, device: &RgbDevice) -> Result<(), String> {
    conn.send(device.index, SETCUSTOMMODE, &[]).await?;
    if let Some(direct) = device.modes.iter().position(|m| m.eq_ignore_ascii_case("direct")) {
        send_mode(conn, device, direct).await?;
    }
    Ok(())
}

// UPDATEMODE con el modo tal cual lo describió el servidor (sus colores y
// velocidad de siempre).
async fn send_mode(conn: &mut Connection, device: &RgbDevice, index: usize) -> Result<(), String> {
    let mode = &device.raw_modes[index];
    let size = 4 + 4 + mode.len();
    let mut payload = Vec::with_capacity(size);
    payload.extend_from_slice(&(size as u32).to_le_bytes());
    payload.extend_from_slice(&(index as i32).to_le_bytes());
    payload.extend_from_slice(mode);
    conn.send(device.index, UPDATEMODE, &payload).await
}

// Un modo de hardware del dispositivo (Rainbow de la RAM, Wave de la
// placa...), para los que Sebastián deja "con su propio programa": siguen
// andando con Miku cerrada. Por nombre, porque el número puede cambiar.
#[tauri::command]
pub async fn rgb_modo_hardware(dispositivo: u32, modo: String) -> Result<(), String> {
    let mut conn = connect().await?;
    let devices = all_devices(&mut conn).await?;
    let device = devices.iter().find(|d| d.index == dispositivo).ok_or("Ese dispositivo ya no está.")?;
    let index = device
        .modes
        .iter()
        .position(|m| m.eq_ignore_ascii_case(&modo))
        .ok_or_else(|| format!("{} no tiene el modo {modo}.", device.name))?;
    send_mode(&mut conn, device, index).await?;
    use tokio::io::AsyncWriteExt;
    let _ = conn.stream.flush().await;
    Ok(())
}

// Paquete UPDATEZONELEDS: data_size (incluye sus propios 4 bytes) + zona
// + cantidad + un RGBColor por LED (bytes R, G, B, 0).
pub(crate) fn zone_leds_payload(zone: u32, colors: &[[u8; 3]]) -> Vec<u8> {
    let size = 4 + 4 + 2 + 4 * colors.len();
    let mut payload = Vec::with_capacity(size);
    payload.extend_from_slice(&(size as u32).to_le_bytes());
    payload.extend_from_slice(&zone.to_le_bytes());
    payload.extend_from_slice(&(colors.len() as u16).to_le_bytes());
    for [r, g, b] in colors {
        payload.extend_from_slice(&[*r, *g, *b, 0]);
    }
    payload
}

// Clave estable de cada dispositivo, igual que deviceKeys en lib/lights.ts:
// su nombre, y si hay varios iguales (los dos módulos de RAM se llaman "ENE
// DRAM") "#2", "#3"... por orden. El número que da OpenRGB puede cambiar.
pub(crate) fn device_keys(devices: &[RgbDevice]) -> Vec<(u32, String)> {
    let mut sorted: Vec<&RgbDevice> = devices.iter().collect();
    sorted.sort_by_key(|d| d.index);
    let mut seen: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
    sorted
        .into_iter()
        .map(|d| {
            let n = seen.entry(d.name.as_str()).or_insert(0);
            *n += 1;
            let key = if *n == 1 { d.name.clone() } else { format!("{}#{}", d.name, n) };
            (d.index, key)
        })
        .collect()
}

fn find_device(devices: Vec<RgbDevice>, index: u32) -> Result<RgbDevice, String> {
    devices
        .into_iter()
        .find(|d| d.index == index)
        .ok_or_else(|| format!("No hay ningún dispositivo con el número {index}."))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbStatus {
    // "corriendo", "detenido" o "no instalado".
    pub service: String,
    // Versión del protocolo con que se habla (0 si no responde).
    pub protocol: u32,
    pub devices: usize,
    pub error: Option<String>,
}

fn service_state() -> String {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    match std::process::Command::new("sc.exe")
        .args(["query", "OpenRGB"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(out) if out.status.success() => {
            if String::from_utf8_lossy(&out.stdout).contains("RUNNING") {
                "corriendo".into()
            } else {
                "detenido".into()
            }
        }
        _ => "no instalado".into(),
    }
}

// Estado de OpenRGB para la pestaña Dispositivos del panel Luces.
#[tauri::command]
pub async fn rgb_estado() -> RgbStatus {
    let service = service_state();
    match Connection::open().await {
        Ok(mut conn) => {
            let protocol = conn.protocol;
            match conn.controller_count().await {
                Ok(n) => RgbStatus { service, protocol, devices: n as usize, error: None },
                Err(e) => RgbStatus { service, protocol, devices: 0, error: Some(e) },
            }
        }
        Err(e) => RgbStatus { service, protocol: 0, devices: 0, error: Some(e) },
    }
}

#[tauri::command]
pub async fn rgb_listar() -> Result<Vec<RgbDevice>, String> {
    // Un reintento: si OpenRGB estaba ocupado (el teclado reiniciándose),
    // al segundo intento ya contesta.
    let first = async {
        let mut conn = connect().await?;
        all_devices(&mut conn).await
    }
    .await;
    match first {
        Err(e) if e.contains("a tiempo") => {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let mut conn = connect().await?;
            all_devices(&mut conn).await
        }
        other => other,
    }
}

// Pone todos los LEDs de los dispositivos elegidos (por índice; vacío =
// todos) en un color fijo. Devuelve los nombres de los que cambió.
#[tauri::command]
pub async fn rgb_poner_color(r: u8, g: u8, b: u8, dispositivos: Vec<u32>) -> Result<Vec<String>, String> {
    let mut conn = connect().await?;
    let devices = all_devices(&mut conn).await?;
    let mut changed = Vec::new();
    for device in devices.iter().filter(|d| dispositivos.is_empty() || dispositivos.contains(&d.index)) {
        if device.leds == 0 {
            continue;
        }
        set_direct(&mut conn, device).await?;
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

// Pinta una zona (panel Luces): un color por LED, o uno solo para toda la
// zona.
#[tauri::command]
pub async fn rgb_pintar_zona(dispositivo: u32, zona: u32, colores: Vec<[u8; 3]>) -> Result<(), String> {
    let mut conn = connect().await?;
    let device = find_device(all_devices(&mut conn).await?, dispositivo)?;
    let zone = device
        .zones
        .iter()
        .find(|z| z.index == zona)
        .ok_or_else(|| format!("«{}» no tiene la zona {zona}.", device.name))?;
    if zone.leds == 0 || colores.is_empty() {
        return Ok(());
    }
    set_direct(&mut conn, &device).await?;
    let count = zone.leds as usize;
    let colors: Vec<[u8; 3]> = (0..count).map(|i| colores[i.min(colores.len() - 1)]).collect();
    let payload = zone_leds_payload(zona, &colors);
    conn.send(device.index, UPDATEZONELEDS, &payload).await?;
    let _ = conn.stream.flush().await;
    Ok(())
}

// Cuántos LEDs tiene lo enchufado en una zona que se puede redimensionar
// (los conectores ARGB de la placa). Devuelve el dispositivo ya cambiado.
#[tauri::command]
pub async fn rgb_redimensionar_zona(dispositivo: u32, zona: u32, tamano: u32) -> Result<RgbDevice, String> {
    let mut conn = connect().await?;
    let device = find_device(all_devices(&mut conn).await?, dispositivo)?;
    let zone = device
        .zones
        .iter()
        .find(|z| z.index == zona)
        .ok_or_else(|| format!("«{}» no tiene la zona {zona}.", device.name))?;
    if zone.leds_min == zone.leds_max {
        return Err(format!("La zona «{}» tiene una cantidad fija de LEDs.", zone.name));
    }
    let size = tamano.clamp(zone.leds_min, zone.leds_max);
    let mut payload = Vec::with_capacity(8);
    payload.extend_from_slice(&(zona as i32).to_le_bytes());
    payload.extend_from_slice(&(size as i32).to_le_bytes());
    conn.send(device.index, RESIZEZONE, &payload).await?;
    let _ = conn.stream.flush().await;
    // El motor de efectos tiene que volver a leer cuántos LEDs hay.
    crate::lights_engine::devices_changed();
    conn.controller(dispositivo).await
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

    // Cambia el tamaño del primer conector ARGB de la placa y lo devuelve.
    #[tokio::test]
    #[ignore]
    async fn redimensiona_un_conector() {
        let board = rgb_listar().await.expect("lista").into_iter().find(|d| d.kind == "placa madre").expect("placa");
        let zone = board.zones.iter().find(|z| z.leds_min != z.leds_max).expect("zona redimensionable");
        println!("{}: {} LEDs (rango {}-{})", zone.name, zone.leds, zone.leds_min, zone.leds_max);
        let after = rgb_redimensionar_zona(board.index, zone.index, 4).await.expect("redimensionar");
        println!("después: {:?}", after.zones.iter().map(|z| (&z.name, z.leds, z.start)).collect::<Vec<_>>());
        let back = rgb_redimensionar_zona(board.index, zone.index, zone.leds).await.expect("volver");
        println!("vuelta: {:?}", back.zones.iter().map(|z| (&z.name, z.leds)).collect::<Vec<_>>());
    }

    // Cuánto tarda OpenRGB en procesar una actualización de cada zona
    // (manda el color que ya tienen: no cambia nada a la vista). La
    // respuesta a REQUEST_CONTROLLER_COUNT llega recién cuando el servidor
    // terminó lo anterior de esta conexión.
    // Solo lee: cuánto tarda la lista de dispositivos (y cada uno) con el
    // motor de Miku andando. Para el aviso "OpenRGB no respondió a tiempo".
    #[tokio::test]
    #[ignore]
    async fn mide_cuanto_tarda_listar() {
        for vuelta in 0..6 {
            let mut conn = Connection::open().await.expect("OpenRGB abierto");
            let start = std::time::Instant::now();
            let n = conn.controller_count().await.unwrap();
            let mut partes = Vec::new();
            for i in 0..n {
                let t = std::time::Instant::now();
                let d = conn.controller(i).await;
                partes.push(format!("{} {:.0} ms", d.map(|d| d.name).unwrap_or_else(|e| e), t.elapsed().as_secs_f64() * 1000.0));
            }
            println!("vuelta {vuelta}: {:.0} ms en total | {}", start.elapsed().as_secs_f64() * 1000.0, partes.join(" | "));
        }
    }

    #[tokio::test]
    #[ignore]
    async fn mide_cuanto_tarda_cada_zona() {
        let mut conn = Connection::open().await.expect("OpenRGB abierto");
        let devices = all_devices(&mut conn).await.expect("lista");
        let color = [43u8, 148, 140];
        for d in &devices {
            for z in d.zones.iter().filter(|z| z.leds > 0) {
                let colors = vec![color; z.leds as usize];
                let start = std::time::Instant::now();
                for _ in 0..5 {
                    conn.send(d.index, UPDATEZONELEDS, &zone_leds_payload(z.index, &colors)).await.unwrap();
                }
                conn.controller_count().await.unwrap();
                println!("{} / {}: {:.1} ms por actualización", d.name, z.name, start.elapsed().as_secs_f64() * 1000.0 / 5.0);
            }
        }
    }

    // Diagnóstico del conector ARGB 2 (con Miku cerrada, para que el motor
    // no se meta): cuatro formas de pintarlo, 8 s cada una.
    #[tokio::test]
    #[ignore]
    async fn diagnostico_argb() {
        let mut conn = Connection::open().await.expect("OpenRGB abierto");
        let mut board = all_devices(&mut conn).await.unwrap().into_iter().find(|d| d.kind == "placa madre").expect("placa");
        let zone = board.zones.iter().find(|z| z.name == "ARGB_V2_2").expect("ARGB_V2_2").index;
        if board.zones[zone as usize].leds == 0 {
            let mut p = (zone as i32).to_le_bytes().to_vec();
            p.extend_from_slice(&8i32.to_le_bytes());
            conn.send(board.index, RESIZEZONE, &p).await.unwrap();
            board = conn.controller(board.index).await.unwrap();
        }
        let z = board.zones[zone as usize].clone();
        println!("ARGB_V2_2: {} LEDs desde el LED {}; dispositivo {} LEDs", z.leds, z.start, board.leds);
        let wait = || tokio::time::sleep(Duration::from_secs(8));

        println!("1/4 ROJO: solo la zona (UPDATEZONELEDS), sin tocar el modo");
        conn.send(board.index, UPDATEZONELEDS, &zone_leds_payload(zone, &vec![[255, 0, 0]; z.leds as usize])).await.unwrap();
        wait().await;

        println!("2/4 VERDE: el dispositivo entero (UPDATELEDS)");
        let mut p = Vec::new();
        let size = 4 + 2 + 4 * board.leds as usize;
        p.extend_from_slice(&(size as u32).to_le_bytes());
        p.extend_from_slice(&board.leds.to_le_bytes());
        for _ in 0..board.leds { p.extend_from_slice(&[0, 255, 0, 0]); }
        conn.send(board.index, UPDATELEDS, &p).await.unwrap();
        wait().await;

        println!("3/4 AZUL: modo directo de nuevo y después la zona");
        set_direct(&mut conn, &board).await.unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        conn.send(board.index, UPDATEZONELEDS, &zone_leds_payload(zone, &vec![[0, 0, 255]; z.leds as usize])).await.unwrap();
        wait().await;

        println!("4/4 AMARILLO: modo de hardware Static de la placa");
        if let Some(idx) = board.modes.iter().position(|m| m == "Static") {
            let mut mode = board.raw_modes[idx].clone();
            let n = mode.len();
            // Los colores del modo van al final (4 bytes cada uno): se cambia
            // el último.
            if n >= 6 { mode[n - 4..].copy_from_slice(&[255, 200, 0, 0]); }
            let mut p = Vec::new();
            p.extend_from_slice(&((8 + mode.len()) as u32).to_le_bytes());
            p.extend_from_slice(&(idx as i32).to_le_bytes());
            p.extend_from_slice(&mode);
            conn.send(board.index, UPDATEMODE, &p).await.unwrap();
        }
        wait().await;
        println!("listo");
    }

    // Los nombres de los LEDs del teclado: ¿está la tira de luz?
    #[tokio::test]
    #[ignore]
    async fn leds_del_teclado() {
        for d in rgb_listar().await.expect("lista").into_iter().filter(|d| d.kind == "teclado" || d.kind == "micrófono") {
            println!("{}: {} LEDs, zonas {:?}", d.name, d.leds, d.zones.iter().map(|z| (&z.name, z.leds)).collect::<Vec<_>>());
            println!("{}", d.led_names.join(" | "));
        }
    }

    // ¿Alguno de los LEDs sin nombre del teclado es la tira de luz? 10 s
    // solo esos en blanco (el resto apagado), después 5 s al revés. Con
    // Miku cerrada, para que el motor no los pise.
    #[tokio::test]
    #[ignore]
    async fn prueba_tira_del_teclado() {
        let mut conn = Connection::open().await.expect("OpenRGB abierto");
        let kbd = all_devices(&mut conn).await.unwrap().into_iter().find(|d| d.kind == "teclado").expect("teclado");
        set_direct(&mut conn, &kbd).await.unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        let unnamed: Vec<usize> = kbd.led_names.iter().enumerate().filter(|(_, n)| n.is_empty()).map(|(i, _)| i).collect();
        println!("LEDs sin nombre: {unnamed:?}");
        let paint = |only_unnamed: bool| -> Vec<[u8; 3]> {
            (0..kbd.leds as usize).map(|i| if unnamed.contains(&i) == only_unnamed { [255, 255, 255] } else { [0, 0, 0] }).collect()
        };
        println!("1/2 solo los sin nombre en blanco (10 s)");
        conn.send(kbd.index, UPDATEZONELEDS, &zone_leds_payload(0, &paint(true))).await.unwrap();
        tokio::time::sleep(Duration::from_secs(10)).await;
        println!("2/2 al revés: las teclas en blanco (5 s)");
        conn.send(kbd.index, UPDATEZONELEDS, &zone_leds_payload(0, &paint(false))).await.unwrap();
        tokio::time::sleep(Duration::from_secs(5)).await;
        println!("listo");
    }
}
