use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::openrgb::{self, Connection, RgbDevice};

// Motor de efectos de las luces (fase 1 de docs/luces-argb/PLAN.md). Vive
// acá y no en el frontend porque, con Miku escondida (modo juego), WebView2
// frena los temporizadores de la página y los efectos se congelarían justo
// cuando más se ven. Un hilo propio con una conexión persistente a OpenRGB
// calcula cada cuadro (30 por segundo por defecto) y manda solo las zonas
// que cambiaron: una escena quieta no manda nada después del primer cuadro.
//
// La escena la arma el frontend (lib/lights.ts) y la guarda; acá solo se
// dibuja. Cada zona se nombra "dispositivo|zona" con la misma clave que usa
// el frontend (ver openrgb::device_keys), no por número: el número que da
// OpenRGB cambia si aparece o desaparece un dispositivo.

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    // static | breathe | rainbow | wave | comet | sparkle | fire
    pub kind: String,
    #[serde(default)]
    pub colors: Vec<[u8; 3]>,
    // 1-100 (50 = normal).
    #[serde(default = "default_speed")]
    pub speed: f32,
    // 0-100, brillo propio del grupo.
    #[serde(default = "default_brightness")]
    pub brightness: f32,
    // 1-100: ancho de la ola, largo de la estela, cantidad de destellos.
    #[serde(default = "default_size")]
    pub size: f32,
    // 1 o -1.
    #[serde(default = "default_direction")]
    pub direction: f32,
}

fn default_speed() -> f32 {
    50.0
}
fn default_brightness() -> f32 {
    100.0
}
fn default_size() -> f32 {
    40.0
}
fn default_direction() -> f32 {
    1.0
}

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub zones: Vec<String>,
    pub effect: Effect,
}

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub groups: Vec<Group>,
    // Posición de cada zona en el mapa del gabinete (0 a 1, de izquierda a
    // derecha), para que la ola cruce el PC entero. Sin posición, se
    // reparten en orden.
    #[serde(default)]
    pub positions: HashMap<String, f32>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Global {
    pub on: bool,
    // 0-100, encima del brillo de cada grupo.
    pub brightness: f32,
    pub paused: bool,
    #[serde(default = "default_fps")]
    pub fps: u32,
}

fn default_fps() -> u32 {
    30
}

impl Default for Global {
    fn default() -> Self {
        Global { on: true, brightness: 100.0, paused: false, fps: 30 }
    }
}

struct EngineState {
    scene: Option<Scene>,
    global: Global,
    // El asistente de ventiladores pinta a mano una zona mientras ajustas:
    // eso manda sobre el efecto.
    // BTreeMap: HashMap::new no se puede usar en un static.
    overrides: BTreeMap<String, Vec<[u8; 3]>>,
    reload_devices: bool,
    preview: bool,
    app: Option<AppHandle>,
}

static STATE: Mutex<EngineState> = Mutex::new(EngineState {
    scene: None,
    global: Global { on: true, brightness: 100.0, paused: false, fps: 30 },
    overrides: BTreeMap::new(),
    reload_devices: false,
    preview: false,
    app: None,
});
static STARTED: AtomicBool = AtomicBool::new(false);
static STOPPED: AtomicBool = AtomicBool::new(false);

const PREVIEW_EVERY: Duration = Duration::from_millis(50);
const RECONNECT_AFTER: Duration = Duration::from_secs(3);
// Cada cuánto se vuelven a mandar todas las zonas aunque no hayan cambiado:
// si algo las reseteó (otro programa, el propio OpenRGB), se corrigen solas.
const REFRESH_EVERY: Duration = Duration::from_secs(2);
// Después de pasar un dispositivo a modo directo, antes de mandarle colores.
// Medido en la PC de Sebastián: en la placa (IT5711) el cambio de modo se
// procesa después y apagaba el conector ARGB que se acababa de pintar.
const AFTER_MODE_CHANGE: Duration = Duration::from_millis(400);

// Una zona ya resuelta contra lo que ve OpenRGB ahora.
struct ResolvedZone {
    device: u32,
    zone: u32,
    leds: usize,
}

struct Resolved {
    zones: HashMap<String, ResolvedZone>,
    // Orden de todas las zonas, para repartir posiciones por defecto.
    order: Vec<String>,
}

fn resolve(devices: &[RgbDevice]) -> Resolved {
    let keys: HashMap<u32, String> = openrgb::device_keys(devices).into_iter().collect();
    let mut zones = HashMap::new();
    let mut order = Vec::new();
    for device in devices {
        let Some(device_key) = keys.get(&device.index) else { continue };
        for zone in &device.zones {
            let key = format!("{device_key}|{}", zone.name);
            order.push(key.clone());
            zones.insert(key, ResolvedZone { device: device.index, zone: zone.index, leds: zone.leds as usize });
        }
    }
    Resolved { zones, order }
}

// --- Efectos (los mismos de la maqueta, docs/luces-argb/maqueta.html) ---

fn mix(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

fn to_f(c: [u8; 3]) -> [f32; 3] {
    [c[0] as f32, c[1] as f32, c[2] as f32]
}

// Un punto (0 a 1, cíclico) de un degradado entre los colores del efecto.
fn gradient_at(colors: &[[u8; 3]], t: f32) -> [f32; 3] {
    match colors.len() {
        0 => [57.0, 197.0, 187.0],
        1 => to_f(colors[0]),
        n => {
            let x = t.rem_euclid(1.0) * n as f32;
            let i = x.floor() as usize;
            mix(to_f(colors[i % n]), to_f(colors[(i + 1) % n]), x - i as f32)
        }
    }
}

fn hue(h: f32) -> [f32; 3] {
    let f = |n: f32| {
        let k = (n + h.rem_euclid(1.0) * 6.0) % 6.0;
        255.0 * (1.0 - k.min(4.0 - k).clamp(0.0, 1.0))
    };
    [f(5.0), f(3.0), f(1.0)]
}

struct Sparkle {
    until: f32,
    on: bool,
    color: usize,
}

struct Renderer {
    rng: u64,
    sparkles: HashMap<(String, usize), Sparkle>,
}

impl Renderer {
    fn random(&mut self) -> f32 {
        // xorshift64: suficiente para destellos.
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        (self.rng >> 40) as f32 / (1u64 << 24) as f32
    }

    fn color(&mut self, effect: &Effect, zone_key: &str, pos: f32, i: usize, n: usize, t: f32) -> [f32; 3] {
        let sp = effect.speed.max(1.0) / 50.0;
        let along = if n > 1 { i as f32 / n as f32 } else { 0.0 };
        let dir = if effect.direction < 0.0 { -1.0 } else { 1.0 };
        let colors = &effect.colors;
        match effect.kind.as_str() {
            "breathe" => {
                let k = ((t * sp * 2.0).sin() + 1.0) / 2.0;
                // Con varios colores, cada respiración usa el siguiente.
                let which = (t * sp / std::f32::consts::PI).floor() / colors.len().max(1) as f32;
                let c = gradient_at(colors, which);
                c.map(|x| x * (0.12 + 0.88 * k))
            }
            "rainbow" => hue(t * sp * 0.15 + along * dir),
            "wave" => {
                let width = 0.15 + effect.size / 120.0;
                gradient_at(colors, (pos + along * 0.12) / width - t * sp * 0.35 * dir)
            }
            "comet" => {
                let head = (t * sp * 0.8 * dir).rem_euclid(1.0);
                let mut d = (along - head).rem_euclid(1.0);
                if dir > 0.0 {
                    d = (1.0 - d).rem_euclid(1.0);
                }
                let tail = (1.0 - d * (6.0 - effect.size / 25.0)).max(0.0);
                gradient_at(colors, 0.0).map(|x| x * tail)
            }
            "sparkle" => {
                let key = (zone_key.to_string(), i);
                let expired = self.sparkles.get(&key).map(|s| s.until < t).unwrap_or(true);
                if expired {
                    let until = t + 0.2 + self.random() * 1.4;
                    let on = self.random() < effect.size / 160.0;
                    let color = (self.random() * colors.len().max(1) as f32) as usize;
                    self.sparkles.insert(key.clone(), Sparkle { until, on, color });
                }
                let s = &self.sparkles[&key];
                if s.on && !colors.is_empty() {
                    to_f(colors[s.color.min(colors.len() - 1)])
                } else {
                    [0.0, 0.0, 0.0]
                }
            }
            "fire" => {
                let f = 0.55 + 0.45 * (t * 9.0 * sp + i as f32 * 1.7 + (t * 3.0 + i as f32).sin()).sin();
                mix([255.0, 60.0, 0.0], [255.0, 190.0, 40.0], f).map(|x| x * (0.5 + f / 2.0))
            }
            // "static" y cualquiera desconocido: el degradado quieto.
            _ => gradient_at(colors, along),
        }
    }
}

fn scale(c: [f32; 3], k: f32) -> [u8; 3] {
    c.map(|x| (x * k).round().clamp(0.0, 255.0) as u8)
}

// Un cuadro: el color de cada LED de cada zona que tiene algo que hacer.
fn render(
    renderer: &mut Renderer,
    scene: &Scene,
    global: &Global,
    overrides: &BTreeMap<String, Vec<[u8; 3]>>,
    resolved: &Resolved,
    t: f32,
) -> HashMap<String, Vec<[u8; 3]>> {
    let mut frame = HashMap::new();
    let total = resolved.order.len().max(1) as f32;
    for group in &scene.groups {
        let k = if global.on { global.brightness / 100.0 * group.effect.brightness / 100.0 } else { 0.0 };
        for key in &group.zones {
            let Some(zone) = resolved.zones.get(key) else { continue };
            if zone.leds == 0 {
                continue;
            }
            let pos = scene.positions.get(key).copied().unwrap_or_else(|| {
                resolved.order.iter().position(|o| o == key).unwrap_or(0) as f32 / total
            });
            let colors = (0..zone.leds)
                .map(|i| scale(renderer.color(&group.effect, key, pos, i, zone.leds, t), k))
                .collect();
            frame.insert(key.clone(), colors);
        }
    }
    for (key, colors) in overrides {
        if let Some(zone) = resolved.zones.get(key) {
            let full = (0..zone.leds).map(|i| colors[i.min(colors.len().saturating_sub(1))]).collect();
            frame.insert(key.clone(), full);
        }
    }
    frame
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PreviewZone {
    key: String,
    colors: Vec<[u8; 3]>,
}

async fn read_devices(conn: &mut Connection) -> Result<(Vec<RgbDevice>, Resolved), String> {
    let devices = openrgb::all_devices(conn).await?;
    let resolved = resolve(&devices);
    Ok((devices, resolved))
}

// Modo directo (el que acepta colores LED por LED) UNA sola vez por
// dispositivo mientras dure el motor: repetirlo -- antes se hacía en cada
// reconexión y cada vez que cambiaba el tamaño de un conector -- apagaba el
// conector ARGB de la placa (ver AFTER_MODE_CHANGE).
async fn ensure_direct(conn: &mut Connection, devices: &[RgbDevice], done: &mut HashSet<String>) -> Result<(), String> {
    let keys: HashMap<u32, String> = openrgb::device_keys(devices).into_iter().collect();
    let mut changed = false;
    for device in devices {
        let Some(key) = keys.get(&device.index) else { continue };
        if done.insert(key.clone()) {
            openrgb::set_direct(conn, device).await?;
            changed = true;
        }
    }
    if changed {
        tokio::time::sleep(AFTER_MODE_CHANGE).await;
    }
    Ok(())
}

async fn run() {
    let mut renderer = Renderer { rng: 0x9E37_79B9_7F4A_7C15, sparkles: HashMap::new() };
    let mut sent: HashMap<String, Vec<[u8; 3]>> = HashMap::new();
    let mut link: Option<(Connection, Resolved)> = None;
    let mut direct_done: HashSet<String> = HashSet::new();
    let mut t = 0.0f32;
    let mut last = Instant::now();
    let mut last_preview = Instant::now();
    let mut last_refresh = Instant::now();

    while !STOPPED.load(Ordering::SeqCst) {
        let (scene, global, overrides, reload, preview, app) = {
            let mut state = STATE.lock().unwrap();
            let reload = std::mem::take(&mut state.reload_devices);
            (state.scene.clone(), state.global.clone(), state.overrides.clone(), reload, state.preview, state.app.clone())
        };
        let frame_time = Duration::from_millis(1000 / global.fps.clamp(5, 60) as u64);
        let now = Instant::now();
        if !global.paused {
            t += (now - last).as_secs_f32();
        }
        last = now;

        let Some(scene) = scene else {
            tokio::time::sleep(frame_time).await;
            continue;
        };
        if link.is_none() {
            let opened = async {
                let mut conn = openrgb::connect().await?;
                let (devices, resolved) = read_devices(&mut conn).await?;
                ensure_direct(&mut conn, &devices, &mut direct_done).await?;
                Ok::<_, String>((conn, resolved))
            };
            match opened.await {
                Ok(l) => {
                    link = Some(l);
                    sent.clear();
                }
                Err(e) => {
                    eprintln!("[LUCES] Motor sin conexión: {e}");
                    tokio::time::sleep(RECONNECT_AFTER).await;
                    continue;
                }
            }
        } else if reload {
            // Cambió la cantidad de LEDs de un conector: se vuelve a leer
            // por la misma conexión, sin volver a tocar el modo.
            let (conn, resolved) = link.as_mut().unwrap();
            match read_devices(conn).await {
                Ok((devices, fresh)) => {
                    if let Err(e) = ensure_direct(conn, &devices, &mut direct_done).await {
                        eprintln!("[LUCES] {e}");
                    }
                    *resolved = fresh;
                    sent.clear();
                }
                Err(e) => {
                    eprintln!("[LUCES] Se cortó la conexión con OpenRGB: {e}");
                    link = None;
                    continue;
                }
            }
        }
        if last_refresh.elapsed() >= REFRESH_EVERY {
            last_refresh = Instant::now();
            sent.clear();
        }
        let (conn, resolved) = link.as_mut().unwrap();
        let frame = render(&mut renderer, &scene, &global, &overrides, resolved, t);

        let mut failed = false;
        for (key, colors) in &frame {
            if sent.get(key) == Some(colors) {
                continue;
            }
            let zone = &resolved.zones[key];
            if let Err(e) = conn.send(zone.device, openrgb::UPDATEZONELEDS, &openrgb::zone_leds_payload(zone.zone, colors)).await {
                eprintln!("[LUCES] Se cortó la conexión con OpenRGB: {e}");
                failed = true;
                break;
            }
            sent.insert(key.clone(), colors.clone());
        }
        if failed {
            link = None;
            continue;
        }

        if preview && last_preview.elapsed() >= PREVIEW_EVERY {
            last_preview = Instant::now();
            if let Some(app) = &app {
                let zones: Vec<PreviewZone> =
                    frame.into_iter().map(|(key, colors)| PreviewZone { key, colors }).collect();
                let _ = app.emit("luces-cuadro", zones);
            }
        }

        let spent = now.elapsed();
        tokio::time::sleep(frame_time.saturating_sub(spent)).await;
    }
}

pub fn start(app: AppHandle) {
    STATE.lock().unwrap().app = Some(app);
    if !STARTED.swap(true, Ordering::SeqCst) {
        tauri::async_runtime::spawn(run());
    }
}

// Lo llama rgb_redimensionar_zona: cambió la cantidad de LEDs de una zona.
pub fn devices_changed() {
    STATE.lock().unwrap().reload_devices = true;
}

// Al cerrar Miku (pedido de Sebastián): las luces quedan quietas en el
// color de la escena actual -- el primer color de cada grupo -- en vez de
// congeladas en el último cuadro de un efecto.
pub fn on_exit() {
    STOPPED.store(true, Ordering::SeqCst);
    let (scene, global) = {
        let state = STATE.lock().unwrap();
        (state.scene.clone(), state.global.clone())
    };
    let Some(scene) = scene else { return };
    let finish = async move {
        // Sin volver a tocar el modo: ya están en directo, y cambiarlo justo
        // antes de salir podía apagar el conector ARGB.
        let mut conn = openrgb::connect().await?;
        let (_, resolved) = read_devices(&mut conn).await?;
        let still = Scene {
            groups: scene
                .groups
                .iter()
                .map(|g| Group {
                    zones: g.zones.clone(),
                    effect: Effect {
                        kind: "static".into(),
                        colors: g.effect.colors.first().map(|c| vec![*c]).unwrap_or_default(),
                        ..g.effect.clone()
                    },
                })
                .collect(),
            positions: scene.positions.clone(),
        };
        let mut renderer = Renderer { rng: 1, sparkles: HashMap::new() };
        let frame = render(&mut renderer, &still, &global, &BTreeMap::new(), &resolved, 0.0);
        for (key, colors) in &frame {
            let zone = &resolved.zones[key];
            conn.send(zone.device, openrgb::UPDATEZONELEDS, &openrgb::zone_leds_payload(zone.zone, colors)).await?;
        }
        use tokio::io::AsyncWriteExt;
        let _ = conn.stream.flush().await;
        Ok::<(), String>(())
    };
    let result = tauri::async_runtime::block_on(async { tokio::time::timeout(Duration::from_secs(3), finish).await });
    if let Ok(Err(e)) = result {
        eprintln!("[LUCES] No se pudo dejar el color al cerrar: {e}");
    }
}

#[tauri::command]
pub fn luces_escena(escena: Scene) {
    STATE.lock().unwrap().scene = Some(escena);
}

#[tauri::command]
pub fn luces_global(global: Global) {
    STATE.lock().unwrap().global = global;
}

// El asistente de ventiladores: pinta una zona a mano (colores = null la
// devuelve al efecto).
#[tauri::command]
pub fn luces_probar_zona(zona: String, colores: Option<Vec<[u8; 3]>>) {
    let mut state = STATE.lock().unwrap();
    match colores {
        Some(colors) if !colors.is_empty() => {
            state.overrides.insert(zona, colors);
        }
        _ => {
            state.overrides.remove(&zona);
        }
    }
}

// La vista previa del panel: mientras está abierto, el motor manda los
// cuadros como evento "luces-cuadro" (20 por segundo).
#[tauri::command]
pub fn luces_vista_previa(activa: bool) {
    STATE.lock().unwrap().preview = activa;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn effect(kind: &str) -> Effect {
        Effect { kind: kind.into(), colors: vec![[57, 197, 187], [240, 80, 143]], speed: 50.0, brightness: 100.0, size: 40.0, direction: 1.0 }
    }

    #[test]
    fn el_estatico_es_el_degradado_quieto() {
        let mut r = Renderer { rng: 1, sparkles: HashMap::new() };
        let a = r.color(&effect("static"), "z", 0.0, 0, 8, 0.0);
        let b = r.color(&effect("static"), "z", 0.0, 0, 8, 5.0);
        assert_eq!(a, b);
        assert_eq!(scale(a, 1.0), [57, 197, 187]);
    }

    #[test]
    fn el_brillo_general_en_cero_apaga() {
        assert_eq!(scale([255.0, 128.0, 10.0], 0.0), [0, 0, 0]);
    }

    #[test]
    fn la_ola_se_mueve_con_el_tiempo() {
        let mut r = Renderer { rng: 1, sparkles: HashMap::new() };
        let a = r.color(&effect("wave"), "z", 0.3, 0, 8, 0.0);
        let b = r.color(&effect("wave"), "z", 0.3, 0, 8, 0.7);
        assert_ne!(scale(a, 1.0), scale(b, 1.0));
    }
}
