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
    // static | breathe | heartbeat | rainbow | wave | flow | comet | sparkle | fire
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
    // Variante del efecto: en "music", "" (golpe) | "vumetro" | "espectro";
    // en "screen", "juegos" = solo mientras hay un juego (si no, sus colores
    // quietos).
    #[serde(default)]
    pub mode: String,
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
    // Fase 4: efectos apilados encima del de base (el de abajo primero).
    #[serde(default)]
    pub layers: Vec<Layer>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub effect: Effect,
    // 0-100.
    #[serde(default = "default_brightness")]
    pub opacity: f32,
    // normal | add | multiply | screen
    #[serde(default = "default_blend")]
    pub blend: String,
    #[serde(default = "yes")]
    pub visible: bool,
}

fn default_blend() -> String {
    "normal".into()
}
fn yes() -> bool {
    true
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
    // Cómo está armada cada zona de verdad (fase 3): cuántos ventiladores
    // hay en un conector, dónde está su LED 1, hacia dónde gira, y la
    // corrección de color del dispositivo.
    #[serde(default)]
    pub zones: HashMap<String, ZoneOptions>,
    // Zonas que Miku no toca (quedan con lo que les ponga su propio
    // programa).
    #[serde(default)]
    pub excluded: Vec<String>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ZoneOptions {
    // Ventiladores encadenados en el conector (cada uno con leds/fans LEDs).
    #[serde(default = "one")]
    pub fans: u32,
    // Qué LED (de cada ventilador) es el primero del efecto.
    #[serde(default)]
    pub offset: u32,
    // Al revés: el efecto recorre los LEDs en el otro sentido.
    #[serde(default)]
    pub reverse: bool,
    // Multiplicador por canal (0 a 1): que el blanco de la RAM y el de los
    // ventiladores se vean iguales.
    #[serde(default = "full_gain")]
    pub gain: [f32; 3],
    // Fuerza de cada LED físico (0 a 1; los que faltan, 1): en el micrófono
    // la luz de arriba y la de abajo son dos LEDs de la misma zona, y la de
    // arriba domina (pedido de Sebastián).
    #[serde(default)]
    pub led_levels: Vec<f32>,
}

fn one() -> u32 {
    1
}
fn full_gain() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}

impl Default for ZoneOptions {
    fn default() -> Self {
        ZoneOptions { fans: 1, offset: 0, reverse: false, gain: full_gain(), led_levels: Vec::new() }
    }
}

// Qué LED del efecto le toca a cada LED físico de la zona: dentro de qué
// ventilador cae, y en qué lugar de ese ventilador según su LED 1 y su
// sentido. Devuelve (ventilador, índice en el ventilador, LEDs de ese
// ventilador).
fn map_led(physical: usize, leds: usize, options: &ZoneOptions) -> (usize, usize, usize) {
    let fans = (options.fans.max(1) as usize).min(leds.max(1));
    let per = (leds / fans).max(1);
    let fan = (physical / per).min(fans - 1);
    let size = if fan == fans - 1 { leds - fan * per } else { per };
    let j = physical - fan * per;
    let offset = options.offset as usize % size.max(1);
    let mut logical = (j + size - offset) % size.max(1);
    if options.reverse {
        logical = (size - logical) % size.max(1);
    }
    (fan, logical, size)
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
    // Qué quedan las luces al cerrar Miku: "static" (el color fijo de la
    // escena) u "off".
    #[serde(default)]
    pub exit_mode: String,
}

fn default_fps() -> u32 {
    30
}

impl Default for Global {
    fn default() -> Self {
        Global { on: true, brightness: 100.0, paused: false, fps: 30, exit_mode: String::new() }
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
    // Dispositivos (parte del nombre, en minúsculas) que hay que volver a
    // poner en modo directo: escribir la configuración del teclado AULA
    // (keyboard_strips.rs) lo saca del directo.
    redo_direct: Vec<String>,
    preview: bool,
    app: Option<AppHandle>,
}

static STATE: Mutex<EngineState> = Mutex::new(EngineState {
    scene: None,
    global: Global { on: true, brightness: 100.0, paused: false, fps: 30, exit_mode: String::new() },
    overrides: BTreeMap::new(),
    reload_devices: false,
    redo_direct: Vec::new(),
    preview: false,
    app: None,
});
static STARTED: AtomicBool = AtomicBool::new(false);
static STOPPED: AtomicBool = AtomicBool::new(false);
// La PC se está suspendiendo o apagando (pedido de Sebastián: que las luces
// no se queden prendidas): el motor no manda nada hasta que despierte.
static SUSPENDED: AtomicBool = AtomicBool::new(false);
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static POWER_WATCH_STARTED: AtomicBool = AtomicBool::new(false);

const PREVIEW_EVERY: Duration = Duration::from_millis(50);
const RECONNECT_AFTER: Duration = Duration::from_secs(3);
// Cada cuánto se vuelven a mandar todas las zonas aunque no hayan cambiado:
// si algo las reseteó (otro programa, el propio OpenRGB), se corrigen solas.
const REFRESH_EVERY: Duration = Duration::from_secs(2);
// Después de pasar un dispositivo a modo directo, antes de mandarle colores.
// Medido en la PC de Sebastián: en la placa (IT5711) el cambio de modo se
// procesa después y apagaba el conector ARGB que se acababa de pintar.
const AFTER_MODE_CHANGE: Duration = Duration::from_millis(400);

// --- Señales para los efectos reactivos (fase 4) ---
//
// Las escriben otros: el analizador de música (music_beat.rs) desde Rust,
// y la voz, el estado y el ánimo de Miku y los avisos desde el frontend
// (lib/lights.ts). El motor las lee una vez por cuadro.

struct SignalInputs {
    music: Option<(crate::music_beat::MusicBeat, Instant)>,
    voice: f32,
    voice_at: Option<Instant>,
    miku_state: String,
    mood: [u8; 3],
    mood_strength: f32,
    flash: Option<([u8; 3], Instant)>,
    screen: [f32; 3],
}

static SIGNALS: Mutex<SignalInputs> = Mutex::new(SignalInputs {
    music: None,
    voice: 0.0,
    voice_at: None,
    miku_state: String::new(),
    mood: [57, 197, 187],
    mood_strength: 0.0,
    flash: None,
    screen: [0.0, 0.0, 0.0],
});
// El ambilight solo captura la pantalla mientras algún efecto la usa.
static SCREEN_WANTED: AtomicBool = AtomicBool::new(false);
static SCREEN_STARTED: AtomicBool = AtomicBool::new(false);

const FLASH_MS: f32 = 1400.0;
// Sin novedades de la voz por esto, se da por callada.
const VOICE_STALE: Duration = Duration::from_millis(400);

// Las señales de este cuadro, ya calculadas.
#[derive(Clone)]
struct Signals {
    // 0-1: cae después de cada golpe de la música.
    beat_pulse: f32,
    // Al instante (ver music_beat::live_levels): volumen y graves, medios y
    // agudos, 0-1.
    live_level: f32,
    bands: [f32; 3],
    in_game: bool,
    // Cuántos golpes van: para cambiar de color con cada uno.
    beat_count: f32,
    // Volumen de lo que suena, 0-1.
    music_level: f32,
    music_confident: bool,
    voice: f32,
    miku_state: String,
    mood: [f32; 3],
    mood_strength: f32,
    screen: [f32; 3],
    // Color del destello de aviso y cuánto se ve ahora (0-1).
    flash: ([f32; 3], f32),
}

impl Default for Signals {
    fn default() -> Self {
        Signals {
            beat_pulse: 0.0,
            live_level: 0.0,
            bands: [0.0; 3],
            in_game: false,
            beat_count: 0.0,
            music_level: 0.0,
            music_confident: false,
            voice: 0.0,
            miku_state: "idle".into(),
            mood: [57.0, 197.0, 187.0],
            mood_strength: 0.0,
            screen: [0.0, 0.0, 0.0],
            flash: ([240.0, 80.0, 143.0], 0.0),
        }
    }
}

fn read_signals(now: Instant, decay_ms: f32) -> Signals {
    let s = SIGNALS.lock().unwrap();
    let mut out = Signals::default();
    if let Some((beat, at)) = &s.music {
        let since_estimate = now.duration_since(*at).as_secs_f32() * 1000.0;
        let period = 60_000.0 / beat.bpm.max(30.0);
        let since_beat = (beat.last_beat_ms_ago + since_estimate).rem_euclid(period);
        out.beat_pulse = (-since_beat / decay_ms.max(40.0)).exp();
        out.beat_count = ((beat.last_beat_ms_ago + since_estimate) / period).floor();
        out.music_level = (beat.level * 4.0).clamp(0.0, 1.0);
        out.music_confident = beat.confidence > 0.3 && since_estimate < 2000.0;
        if since_estimate > 2000.0 {
            out.music_level = 0.0;
        } else {
            let [level, bass, mid, treble] = crate::music_beat::live_levels();
            out.live_level = level;
            out.bands = [bass, mid, treble];
        }
    }
    out.in_game = IN_GAME.load(Ordering::SeqCst);
    let fresh_voice = s.voice_at.map(|at| now.duration_since(at) < VOICE_STALE).unwrap_or(false);
    out.voice = if fresh_voice { s.voice.clamp(0.0, 1.0) } else { 0.0 };
    if !s.miku_state.is_empty() {
        out.miku_state = s.miku_state.clone();
    }
    out.mood = to_f(s.mood);
    out.mood_strength = s.mood_strength.clamp(0.0, 1.0);
    out.screen = s.screen;
    if let Some((color, at)) = s.flash {
        let ms = now.duration_since(at).as_secs_f32() * 1000.0;
        if ms < FLASH_MS {
            // Dos pulsos que se apagan.
            let pulse = ((ms / FLASH_MS) * std::f32::consts::PI * 4.0).sin().abs();
            out.flash = (to_f(color), pulse * (1.0 - ms / FLASH_MS));
        }
    }
    out
}

// Promedio de colores de la pantalla principal, unas 8 veces por segundo,
// solo mientras un efecto "screen" esté en uso.
fn start_screen_sampler() {
    if SCREEN_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| loop {
        if !SCREEN_WANTED.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(500));
            continue;
        }
        let monitors = xcap::Monitor::all().unwrap_or_default();
        let primary = monitors.iter().find(|m| m.is_primary().unwrap_or(false)).or(monitors.first());
        if let Some(image) = primary.and_then(|m| m.capture_image().ok()) {
            let (w, h) = image.dimensions();
            let step = 24;
            let (mut sum, mut n) = ([0f64; 3], 0f64);
            for y in (0..h).step_by(step) {
                for x in (0..w).step_by(step) {
                    let p = image.get_pixel(x, y).0;
                    sum[0] += p[0] as f64;
                    sum[1] += p[1] as f64;
                    sum[2] += p[2] as f64;
                    n += 1.0;
                }
            }
            if n > 0.0 {
                let avg = [sum[0] / n, sum[1] / n, sum[2] / n].map(|x| x as f32);
                // Más saturado: el promedio de una pantalla tiende al gris.
                let gray = (avg[0] + avg[1] + avg[2]) / 3.0;
                let vivid = avg.map(|x| (gray + (x - gray) * 1.8).clamp(0.0, 255.0));
                let mut s = SIGNALS.lock().unwrap();
                s.screen = mix(s.screen, vivid, 0.5);
            }
        }
        std::thread::sleep(Duration::from_millis(120));
    });
}

// Lo llama music_beat.rs con cada estimación (unas 4 por segundo).
// Hay un juego en primer plano (lo dice game_mode.rs): para "Pantalla solo
// en juegos".
static IN_GAME: AtomicBool = AtomicBool::new(false);
pub fn set_in_game(active: bool) {
    IN_GAME.store(active, Ordering::SeqCst);
}

pub fn music_beat(beat: &crate::music_beat::MusicBeat) {
    SIGNALS.lock().unwrap().music = Some((beat.clone(), Instant::now()));
}

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

    // El color de un LED y cuánto se ve (alpha 0-1: solo "notify" es
    // transparente cuando no hay aviso, para usarlo como capa).
    #[allow(clippy::too_many_arguments)]
    fn color(&mut self, effect: &Effect, zone_key: &str, pos: f32, i: usize, n: usize, t: f32, sig: &Signals) -> ([f32; 3], f32) {
        if effect.kind == "notify" {
            let (color, amount) = sig.flash;
            let c = if effect.colors.is_empty() { color } else { to_f(effect.colors[0]) };
            return (c, amount);
        }
        (self.solid(effect, zone_key, pos, i, n, t, sig), 1.0)
    }

    #[allow(clippy::too_many_arguments)]
    fn solid(&mut self, effect: &Effect, zone_key: &str, pos: f32, i: usize, n: usize, t: f32, sig: &Signals) -> [f32; 3] {
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
            // Latido: dos golpes seguidos (el segundo más suave) y una pausa.
            "heartbeat" => {
                let p = (t * sp * 0.8).rem_euclid(1.0);
                let pulse = |c: f32| (-((p - c) / 0.06).powi(2)).exp();
                let k = (pulse(0.1) + 0.65 * pulse(0.32)).min(1.0);
                gradient_at(colors, 0.0).map(|x| x * (0.08 + 0.92 * k))
            }
            "rainbow" => hue(t * sp * 0.15 + along * dir),
            // Degradado animado: los colores se mezclan y corren a lo largo
            // de cada zona (la ola, en cambio, cruza el gabinete entero).
            "flow" => {
                let stretch = 0.3 + effect.size / 60.0;
                gradient_at(colors, along / stretch - t * sp * 0.2 * dir)
            }
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
            // Música: pulsa con cada golpe y cambia de color con el
            // siguiente; sin un pulso claro (voz, ruido), sigue el volumen.
            // Vúmetro: la zona se llena según el volumen, del primer color al
            // último a lo largo.
            "music" if effect.mode == "vumetro" => {
                let lit = if along < sig.live_level { 1.0 } else { 0.06 };
                gradient_at(colors, along * 0.999).map(|x| x * lit)
            }
            // Espectro: a lo largo de la zona, de los graves a los agudos.
            "music" if effect.mode == "espectro" => {
                let x = along * 2.0;
                let band = if x < 1.0 { sig.bands[0] + (sig.bands[1] - sig.bands[0]) * x } else { sig.bands[1] + (sig.bands[2] - sig.bands[1]) * (x - 1.0) };
                gradient_at(colors, along * 0.999).map(|c| c * (0.05 + 0.95 * band))
            }
            "music" => {
                let c = gradient_at(colors, sig.beat_count / colors.len().max(1) as f32 + (pos + along * 0.2) * 0.3);
                let k = if sig.music_confident { sig.beat_pulse.max(sig.music_level * 0.35) } else { sig.music_level };
                c.map(|x| x * (0.08 + 0.92 * k))
            }
            // La voz de Miku: hablando, el brillo sigue su voz; escuchando,
            // rosa que respira; pensando, un barrido turquesa; en reposo,
            // su color tenue.
            "voice" => {
                let base = gradient_at(colors, 0.0);
                match sig.miku_state.as_str() {
                    "speaking" => base.map(|x| x * (0.15 + 0.85 * sig.voice)),
                    "listening" => [240.0, 80.0, 143.0].map(|x| x * (0.35 + 0.35 * ((t * 4.0).sin() + 1.0))),
                    "thinking" => {
                        let head = (t * 0.9).rem_euclid(1.0);
                        let d = (along - head).rem_euclid(1.0).min((head - along).rem_euclid(1.0));
                        [57.0, 197.0, 187.0].map(|x| x * (0.15 + 0.85 * (1.0 - d * 5.0).max(0.0)))
                    }
                    _ => base.map(|x| x * 0.25),
                }
            }
            // Su ánimo: el color de su ánimo, más fuerte cuanto más lo
            // siente, con una respiración lenta.
            "mood" => {
                let neutral = gradient_at(colors, 0.0);
                let c = mix(neutral, sig.mood, sig.mood_strength);
                let k = 0.35 + 0.55 * sig.mood_strength + 0.1 * (t * 0.8).sin();
                c.map(|x| x * k)
            }
            // Ambilight: el color promedio de la pantalla.
            "screen" if effect.mode == "juegos" && !sig.in_game => gradient_at(colors, along),
            "screen" => sig.screen,
            // "static" y cualquiera desconocido: el degradado quieto.
            _ => gradient_at(colors, along),
        }
    }
}

fn scale(c: [f32; 3], k: f32) -> [u8; 3] {
    c.map(|x| (x * k).round().clamp(0.0, 255.0) as u8)
}

fn blend(base: [f32; 3], top: [f32; 3], alpha: f32, mode: &str) -> [f32; 3] {
    let a = alpha.clamp(0.0, 1.0);
    let mixed = match mode {
        "add" => [0, 1, 2].map(|c| (base[c] + top[c]).min(255.0)),
        "multiply" => [0, 1, 2].map(|c| base[c] * top[c] / 255.0),
        "screen" => [0, 1, 2].map(|c| 255.0 - (255.0 - base[c]) * (255.0 - top[c]) / 255.0),
        _ => top,
    };
    mix(base, mixed, a)
}

// Un cuadro: el color de cada LED de cada zona que tiene algo que hacer.
#[allow(clippy::too_many_arguments)]
fn render(
    renderer: &mut Renderer,
    scene: &Scene,
    global: &Global,
    overrides: &BTreeMap<String, Vec<[u8; 3]>>,
    resolved: &Resolved,
    t: f32,
    sig: &Signals,
) -> HashMap<String, Vec<[u8; 3]>> {
    let mut frame = HashMap::new();
    let total = resolved.order.len().max(1) as f32;
    let master = if global.on { global.brightness / 100.0 } else { 0.0 };
    for group in &scene.groups {
        for key in &group.zones {
            let Some(zone) = resolved.zones.get(key) else { continue };
            if zone.leds == 0 {
                continue;
            }
            if scene.excluded.contains(key) {
                continue;
            }
            let pos = scene.positions.get(key).copied().unwrap_or_else(|| {
                resolved.order.iter().position(|o| o == key).unwrap_or(0) as f32 / total
            });
            let options = scene.zones.get(key).cloned().unwrap_or_default();
            let colors = (0..zone.leds)
                .map(|p| {
                    let (fan, i, n) = map_led(p, zone.leds, &options);
                    // Cada ventilador un poco más allá en el mapa: la ola
                    // pasa de uno al siguiente.
                    let pos = pos + fan as f32 * 0.06;
                    let (base, alpha) = renderer.color(&group.effect, key, pos, i, n, t, sig);
                    let mut c = base.map(|x| x * alpha * group.effect.brightness / 100.0);
                    for layer in group.layers.iter().filter(|l| l.visible) {
                        let (top, a) = renderer.color(&layer.effect, key, pos, i, n, t, sig);
                        let top = top.map(|x| x * layer.effect.brightness / 100.0);
                        c = blend(c, top, a * layer.opacity / 100.0, &layer.blend);
                    }
                    let level = options.led_levels.get(p).copied().unwrap_or(1.0).clamp(0.0, 1.0);
                    let c = scale(c, master * level);
                    [0, 1, 2].map(|ch| (c[ch] as f32 * options.gain[ch].clamp(0.0, 1.0)).round() as u8)
                })
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

const STILL_FRAME: Duration = Duration::from_millis(150);

fn is_still(scene: &Scene) -> bool {
    scene
        .groups
        .iter()
        .all(|g| g.effect.kind == "static" && g.layers.iter().all(|l| !l.visible || l.effect.kind == "static"))
}

fn uses_kind(scene: &Scene, kind: &str) -> bool {
    scene.groups.iter().any(|g| g.effect.kind == kind || g.layers.iter().any(|l| l.visible && l.effect.kind == kind))
}

// Lo rápido que se apaga el pulso de la música: el "tamaño" del primer
// efecto música que haya.
fn music_decay(scene: &Scene) -> f32 {
    scene
        .groups
        .iter()
        .flat_map(|g| std::iter::once(&g.effect).chain(g.layers.iter().map(|l| &l.effect)))
        .find(|e| e.kind == "music")
        .map(|e| 60.0 + e.size * 4.0)
        .unwrap_or(220.0)
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
            let redo = std::mem::take(&mut state.redo_direct);
            if !redo.is_empty() {
                direct_done.retain(|key| !redo.iter().any(|name| key.to_lowercase().contains(name)));
            }
            (state.scene.clone(), state.global.clone(), state.overrides.clone(), reload || !redo.is_empty(), state.preview, state.app.clone())
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
        if SUSPENDED.load(Ordering::SeqCst) || SHUTTING_DOWN.load(Ordering::SeqCst) {
            // La conexión puede no sobrevivir a la suspensión: al despertar
            // se abre una nueva.
            link = None;
            tokio::time::sleep(Duration::from_millis(250)).await;
            continue;
        }
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
        // La pantalla se mira solo si algún efecto la usa ahora (con "solo
        // en juegos" y sin juego, no).
        let in_game = IN_GAME.load(Ordering::SeqCst);
        let wants_screen = scene.groups.iter().any(|g| {
            std::iter::once(&g.effect)
                .chain(g.layers.iter().filter(|l| l.visible).map(|l| &l.effect))
                .any(|e| e.kind == "screen" && (e.mode != "juegos" || in_game))
        });
        SCREEN_WANTED.store(wants_screen, Ordering::SeqCst);
        if wants_screen {
            start_screen_sampler();
        }
        let signals = read_signals(now, music_decay(&scene));
        let frame = render(&mut renderer, &scene, &global, &overrides, resolved, t, &signals);

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
        // Escena quieta (todo estático, sin nada pintado a mano): no hace
        // falta dibujar 30 veces por segundo; el reenvío cada 2 s sigue.
        let frame_time = if overrides.is_empty() && is_still(&scene) { STILL_FRAME } else { frame_time };
        tokio::time::sleep(frame_time.saturating_sub(spent)).await;
    }
}

pub fn start(app: AppHandle) {
    STATE.lock().unwrap().app = Some(app);
    if !STARTED.swap(true, Ordering::SeqCst) {
        tauri::async_runtime::spawn(run());
    }
    start_power_watch();
}

// Todas las zonas que maneja Miku, apagadas. Corto y con tiempo límite: se
// llama justo antes de que Windows suspenda o apague, cuando hay un par de
// segundos nada más.
fn lights_off_now() {
    let scene = STATE.lock().unwrap().scene.clone();
    let Some(scene) = scene else { return };
    let finish = async move {
        let mut conn = openrgb::connect().await?;
        let (_, resolved) = read_devices(&mut conn).await?;
        let off = Global { on: false, ..Global::default() };
        let mut renderer = Renderer { rng: 1, sparkles: HashMap::new() };
        let frame = render(&mut renderer, &scene, &off, &BTreeMap::new(), &resolved, 0.0, &Signals::default());
        for (key, colors) in &frame {
            let zone = &resolved.zones[key];
            conn.send(zone.device, openrgb::UPDATEZONELEDS, &openrgb::zone_leds_payload(zone.zone, colors)).await?;
        }
        use tokio::io::AsyncWriteExt;
        let _ = conn.stream.flush().await;
        Ok::<(), String>(())
    };
    let result = tauri::async_runtime::block_on(async { tokio::time::timeout(Duration::from_millis(1500), finish).await });
    if let Ok(Err(e)) = result {
        eprintln!("[LUCES] No se pudieron apagar: {e}");
    }
}

// Avisos de energía de Windows: una ventana invisible de nivel superior
// (las ventanas solo-mensajes no reciben estos avisos) con su propio bucle.
// - Suspender (PBT_APMSUSPEND): luces apagadas y el motor quieto.
// - Despertar (PBT_APMRESUMEAUTOMATIC / PBT_APMRESUMESUSPEND): el motor
//   vuelve a conectar y redibuja la escena.
// - Cerrar sesión o apagar (WM_QUERYENDSESSION): luces apagadas.
fn start_power_watch() {
    if POWER_WATCH_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| unsafe {
        use windows::core::w;
        use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage, MSG,
            PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, WINDOW_EX_STYLE, WM_ENDSESSION,
            WM_POWERBROADCAST, WM_QUERYENDSESSION, WNDCLASSW, WS_OVERLAPPED,
        };

        unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
            match msg {
                WM_POWERBROADCAST => {
                    match wparam.0 as u32 {
                        PBT_APMSUSPEND => {
                            SUSPENDED.store(true, Ordering::SeqCst);
                            lights_off_now();
                        }
                        PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => {
                            SUSPENDED.store(false, Ordering::SeqCst);
                        }
                        _ => {}
                    }
                    LRESULT(1)
                }
                WM_QUERYENDSESSION => {
                    if !SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
                        lights_off_now();
                    }
                    LRESULT(1)
                }
                WM_ENDSESSION => {
                    // wparam = 0: se canceló el apagado; las luces vuelven.
                    if wparam.0 == 0 {
                        SHUTTING_DOWN.store(false, Ordering::SeqCst);
                    }
                    LRESULT(0)
                }
                _ => DefWindowProcW(hwnd, msg, wparam, lparam),
            }
        }

        let Ok(module) = GetModuleHandleW(None) else { return };
        let class = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: module.into(), lpszClassName: w!("MikuLucesEnergia"), ..Default::default() };
        if RegisterClassW(&class) == 0 {
            eprintln!("[LUCES] No se pudo registrar la ventana de avisos de energía.");
            return;
        }
        let created = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("MikuLucesEnergia"),
            w!("Miku luces"),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(module.into()),
            None,
        );
        if created.is_err() {
            eprintln!("[LUCES] No se pudo crear la ventana de avisos de energía.");
            return;
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}

// Lo llama rgb_redimensionar_zona: cambió la cantidad de LEDs de una zona.
pub fn devices_changed() {
    STATE.lock().unwrap().reload_devices = true;
}

// Lo llama keyboard_strips: se escribió la configuración del teclado, que
// lo sacó del modo directo. `name`: parte del nombre, en minúsculas.
pub fn redo_direct(name: &str) {
    STATE.lock().unwrap().redo_direct.push(name.to_string());
}

// Al cerrar Miku (pedido de Sebastián): las luces quedan quietas en el
// color de la escena actual -- el primer color de cada grupo -- en vez de
// congeladas en el último cuadro de un efecto.
pub fn on_exit() {
    STOPPED.store(true, Ordering::SeqCst);
    // Si es Windows el que se apaga, las luces se apagan (ya lo hizo el
    // aviso de energía, pero por las dudas); si es Miku la que se cierra,
    // quedan en el color fijo de la escena.
    let windows_closing = SHUTTING_DOWN.load(Ordering::SeqCst)
        || unsafe { windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics(windows::Win32::UI::WindowsAndMessaging::SM_SHUTTINGDOWN) } != 0;
    let exit_off = STATE.lock().unwrap().global.exit_mode == "off";
    if windows_closing || exit_off {
        lights_off_now();
        return;
    }
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
                    layers: Vec::new(),
                    zones: g.zones.clone(),
                    effect: Effect {
                        kind: "static".into(),
                        colors: g.effect.colors.first().map(|c| vec![*c]).unwrap_or_default(),
                        ..g.effect.clone()
                    },
                })
                .collect(),
            positions: scene.positions.clone(),
            zones: scene.zones.clone(),
            excluded: scene.excluded.clone(),
        };
        let mut renderer = Renderer { rng: 1, sparkles: HashMap::new() };
        let frame = render(&mut renderer, &still, &global, &BTreeMap::new(), &resolved, 0.0, &Signals::default());
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

// Un dispositivo vuelve a "Miku lo maneja" después de estar en un modo de
// hardware: hay que volver a ponerlo en directo.
#[tauri::command]
pub fn luces_rehacer_directo(nombre: String) {
    redo_direct(&nombre.to_lowercase());
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

// Respaldo de perfiles (pestaña Perfiles): el frontend elige dónde con el
// diálogo de archivos y acá se escribe o se lee, sin depender de los
// permisos de carpetas del frontend.
#[tauri::command]
pub fn luces_exportar(ruta: String, contenido: String) -> Result<(), String> {
    std::fs::write(&ruta, contenido).map_err(|e| format!("No se pudo guardar el archivo: {e}"))
}

#[tauri::command]
pub fn luces_importar(ruta: String) -> Result<String, String> {
    std::fs::read_to_string(&ruta).map_err(|e| format!("No se pudo leer el archivo: {e}"))
}

// --- Señales que manda el frontend (ver lib/lights.ts) ---

// Nivel de la voz de Miku mientras habla (0-1, el mismo que mueve su boca).
#[tauri::command]
pub fn luces_voz(nivel: f32) {
    let mut s = SIGNALS.lock().unwrap();
    s.voice = nivel;
    s.voice_at = Some(Instant::now());
}

// idle | listening | thinking | speaking
#[tauri::command]
pub fn luces_estado_miku(estado: String) {
    SIGNALS.lock().unwrap().miku_state = estado;
}

// El color de su ánimo y cuánto lo siente (0-1).
#[tauri::command]
pub fn luces_animo(color: [u8; 3], fuerza: f32) {
    let mut s = SIGNALS.lock().unwrap();
    s.mood = color;
    s.mood_strength = fuerza;
}

// Un aviso (correo, recordatorio, evento): destello en las capas "notify".
#[tauri::command]
pub fn luces_destello(color: Option<[u8; 3]>) {
    SIGNALS.lock().unwrap().flash = Some((color.unwrap_or([240, 80, 143]), Instant::now()));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn effect(kind: &str) -> Effect {
        Effect {
            kind: kind.into(),
            colors: vec![[57, 197, 187], [240, 80, 143]],
            speed: 50.0,
            brightness: 100.0,
            size: 40.0,
            direction: 1.0,
            mode: String::new(),
        }
    }

    #[test]
    fn el_estatico_es_el_degradado_quieto() {
        let mut r = Renderer { rng: 1, sparkles: HashMap::new() };
        let a = r.color(&effect("static"), "z", 0.0, 0, 8, 0.0, &Signals::default()).0;
        let b = r.color(&effect("static"), "z", 0.0, 0, 8, 5.0, &Signals::default()).0;
        assert_eq!(a, b);
        assert_eq!(scale(a, 1.0), [57, 197, 187]);
    }

    #[test]
    fn el_aviso_es_transparente_sin_destello_y_las_capas_mezclan() {
        let mut r = Renderer { rng: 1, sparkles: HashMap::new() };
        let (_, alpha) = r.color(&effect("notify"), "z", 0.0, 0, 8, 0.0, &Signals::default());
        assert_eq!(alpha, 0.0);
        let flashing = Signals { flash: ([255.0, 0.0, 0.0], 1.0), ..Signals::default() };
        let (c, alpha) = r.color(&Effect { colors: vec![], ..effect("notify") }, "z", 0.0, 0, 8, 0.0, &flashing);
        assert_eq!((c, alpha), ([255.0, 0.0, 0.0], 1.0));
        assert_eq!(blend([100.0, 100.0, 100.0], [200.0, 0.0, 0.0], 0.5, "normal"), [150.0, 50.0, 50.0]);
        assert_eq!(blend([200.0, 200.0, 200.0], [100.0, 100.0, 100.0], 1.0, "add"), [255.0, 255.0, 255.0]);
    }

    #[test]
    fn la_musica_pulsa_con_el_golpe() {
        let mut r = Renderer { rng: 1, sparkles: HashMap::new() };
        let on_beat = Signals { beat_pulse: 1.0, music_confident: true, ..Signals::default() };
        let between = Signals { beat_pulse: 0.0, music_confident: true, ..Signals::default() };
        let a = r.color(&effect("music"), "z", 0.0, 0, 8, 0.0, &on_beat).0;
        let b = r.color(&effect("music"), "z", 0.0, 0, 8, 0.0, &between).0;
        assert!(a[1] > b[1] * 5.0);
    }

    #[test]
    fn el_brillo_general_en_cero_apaga() {
        assert_eq!(scale([255.0, 128.0, 10.0], 0.0), [0, 0, 0]);
    }

    #[test]
    fn el_led_1_y_el_sentido_reordenan_cada_ventilador() {
        let normal = ZoneOptions::default();
        assert_eq!(map_led(0, 8, &normal), (0, 0, 8));
        let shifted = ZoneOptions { offset: 2, ..ZoneOptions::default() };
        assert_eq!(map_led(2, 8, &shifted), (0, 0, 8));
        let reversed = ZoneOptions { reverse: true, ..ZoneOptions::default() };
        assert_eq!(map_led(1, 8, &reversed), (0, 7, 8));
        let three = ZoneOptions { fans: 3, ..ZoneOptions::default() };
        assert_eq!(map_led(9, 24, &three), (1, 1, 8));
        // Si no divide justo, el último ventilador se queda con el resto.
        assert_eq!(map_led(9, 10, &ZoneOptions { fans: 3, ..ZoneOptions::default() }), (2, 3, 4));
    }

    #[test]
    fn la_fuerza_por_led_baja_solo_ese_led() {
        let resolved = Resolved {
            zones: HashMap::from([("mic|Microphone".to_string(), ResolvedZone { device: 0, zone: 0, leds: 2 })]),
            order: vec!["mic|Microphone".to_string()],
        };
        let mut options = ZoneOptions::default();
        options.led_levels = vec![0.5];
        let scene = Scene {
            groups: vec![Group { zones: vec!["mic|Microphone".into()], effect: Effect { colors: vec![[200, 100, 50]], ..effect("static") }, layers: vec![] }],
            zones: HashMap::from([("mic|Microphone".to_string(), options)]),
            ..Scene::default()
        };
        let mut r = Renderer { rng: 1, sparkles: HashMap::new() };
        let frame = render(&mut r, &scene, &Global::default(), &BTreeMap::new(), &resolved, 0.0, &Signals::default());
        assert_eq!(frame["mic|Microphone"], vec![[100, 50, 25], [200, 100, 50]]);
    }

    #[test]
    fn el_latido_tiene_dos_golpes_y_una_pausa() {
        let mut r = Renderer { rng: 1, sparkles: HashMap::new() };
        let fx = Effect { colors: vec![[255, 0, 0]], speed: 50.0, ..effect("heartbeat") };
        // speed 50 -> un ciclo cada 1.25 s: golpes en 0.125 s y 0.4 s.
        let at = |r: &mut Renderer, t: f32| r.color(&fx, "z", 0.0, 0, 1, t, &Signals::default()).0[0];
        assert!(at(&mut r, 0.125) > 240.0);
        assert!(at(&mut r, 0.4) > 150.0);
        assert!(at(&mut r, 0.9) < 40.0);
    }

    #[test]
    fn el_vumetro_se_llena_con_el_volumen_y_la_pantalla_espera_un_juego() {
        let mut r = Renderer { rng: 1, sparkles: HashMap::new() };
        let vu = Effect { mode: "vumetro".into(), ..effect("music") };
        let half = Signals { live_level: 0.5, ..Signals::default() };
        let low = r.color(&vu, "z", 0.0, 1, 10, 0.0, &half).0;
        let high = r.color(&vu, "z", 0.0, 8, 10, 0.0, &half).0;
        assert!(low[1] > 100.0 && high[1] < 20.0);
        let screen = Effect { mode: "juegos".into(), ..effect("screen") };
        let playing = Signals { in_game: true, screen: [9.0, 9.0, 9.0], ..Signals::default() };
        assert_eq!(r.color(&screen, "z", 0.0, 0, 1, 0.0, &playing).0, [9.0, 9.0, 9.0]);
        assert_eq!(r.color(&screen, "z", 0.0, 0, 1, 0.0, &Signals::default()).0, [57.0, 197.0, 187.0]);
    }

    #[test]
    fn la_ola_se_mueve_con_el_tiempo() {
        let mut r = Renderer { rng: 1, sparkles: HashMap::new() };
        let a = r.color(&effect("wave"), "z", 0.3, 0, 8, 0.0, &Signals::default()).0;
        let b = r.color(&effect("wave"), "z", 0.3, 0, 8, 0.7, &Signals::default()).0;
        assert_ne!(scale(a, 1.0), scale(b, 1.0));
    }
}
