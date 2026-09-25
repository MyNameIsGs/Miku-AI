use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{Emitter, WebviewWindow};

// Punto 5b del plan: Miku sigue la música que suena en la PC. Spotify ya no
// da el tempo a apps como esta (Audio Features devuelve 403 desde el
// 27-11-2024), así que se escucha el audio de la PC directamente: WASAPI en
// modo loopback sobre la salida por defecto (sirve con cualquier música:
// Spotify, YouTube, un juego).
//
// El análisis es liviano y sin librerías: energía de graves y de toda la
// banda cada ~11,6 ms, su subida ("onset") como curva de golpes, y la
// autocorrelación de esa curva en los últimos 6 s para el tempo (60-180
// BPM). La fase dice hace cuánto cayó el último golpe. `confidence` mide
// qué tan claro es el pulso: con voz, ruido o música sin golpe marcado
// queda baja, y el frontend no la hace moverse.

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MusicBeat {
    pub bpm: f32,
    // 0-1: qué tan claro es el pulso.
    pub confidence: f32,
    // Volumen (RMS) del último segundo, 0-1.
    pub level: f32,
    // Hace cuántos ms cayó el último golpe.
    pub last_beat_ms_ago: f32,
}

const FRAME_SECONDS: f32 = 0.0116;
const WINDOW_SECONDS: f32 = 6.0;
const MIN_ANALYSIS_SECONDS: f32 = 3.0;
const BPM_MIN: f32 = 60.0;
const BPM_MAX: f32 = 180.0;
// Preferencia suave por tempos cercanos a este (evita elegir el doble o la
// mitad cuando las dos opciones puntúan parecido).
const BPM_PRIOR_CENTER: f32 = 115.0;
const BPM_PRIOR_OCTAVES_SIGMA: f32 = 0.7;
// Corte del filtro de graves (bombo, bajo).
const LOW_CUTOFF_HZ: f32 = 150.0;

pub struct BeatTracker {
    hop: usize,
    fps: f32,
    lp_state: f32,
    lp_alpha: f32,
    acc_low: f32,
    acc_all: f32,
    acc_n: usize,
    prev_low_db: f32,
    prev_all_db: f32,
    env: VecDeque<f32>,
    rms: VecDeque<f32>,
    capacity: usize,
}

impl BeatTracker {
    pub fn new(sample_rate: f32) -> Self {
        let hop = (sample_rate * FRAME_SECONDS).round().max(1.0) as usize;
        let fps = sample_rate / hop as f32;
        let dt = 1.0 / sample_rate;
        let rc = 1.0 / (2.0 * std::f32::consts::PI * LOW_CUTOFF_HZ);
        BeatTracker {
            hop,
            fps,
            lp_state: 0.0,
            lp_alpha: dt / (rc + dt),
            acc_low: 0.0,
            acc_all: 0.0,
            acc_n: 0,
            prev_low_db: -100.0,
            prev_all_db: -100.0,
            env: VecDeque::new(),
            rms: VecDeque::new(),
            capacity: (WINDOW_SECONDS * fps) as usize,
        }
    }

    pub fn push(&mut self, mono: &[f32]) {
        for &s in mono {
            self.lp_state += self.lp_alpha * (s - self.lp_state);
            self.acc_low += self.lp_state * self.lp_state;
            self.acc_all += s * s;
            self.acc_n += 1;
            if self.acc_n == self.hop {
                self.frame();
            }
        }
    }

    fn frame(&mut self) {
        let n = self.acc_n as f32;
        let low_db = 10.0 * (self.acc_low / n + 1e-10).log10();
        let all_db = 10.0 * (self.acc_all / n + 1e-10).log10();
        // Solo las subidas cuentan como golpe; en silencio (< -60 dB) no hay.
        let onset = if all_db > -60.0 {
            (low_db - self.prev_low_db).max(0.0) + 0.5 * (all_db - self.prev_all_db).max(0.0)
        } else {
            0.0
        };
        self.prev_low_db = low_db;
        self.prev_all_db = all_db;
        self.env.push_back(onset);
        self.rms.push_back((self.acc_all / n).sqrt());
        while self.env.len() > self.capacity {
            self.env.pop_front();
            self.rms.pop_front();
        }
        self.acc_low = 0.0;
        self.acc_all = 0.0;
        self.acc_n = 0;
    }

    pub fn estimate(&self) -> Option<MusicBeat> {
        let n = self.env.len();
        if (n as f32) < MIN_ANALYSIS_SECONDS * self.fps {
            return None;
        }
        // Suavizado de la curva de golpes (±2 cuadros): el período casi nunca
        // es un número entero de cuadros, y con golpes de un cuadro de ancho
        // el desfase se acumula y borra el pico del período verdadero (a 150
        // BPM, 34,47 cuadros, elegía el doble).
        let env: Vec<f32> = self.env.iter().copied().collect();
        const KERNEL: [f32; 5] = [1.0, 2.0, 3.0, 2.0, 1.0];
        let raw: Vec<f32> = (0..n)
            .map(|i| {
                let mut sum = 0.0;
                let mut weight = 0.0;
                for (k, w) in KERNEL.iter().enumerate() {
                    let j = i as isize + k as isize - 2;
                    if j >= 0 && (j as usize) < n {
                        sum += env[j as usize] * w;
                        weight += w;
                    }
                }
                sum / weight
            })
            .collect();
        let mean = raw.iter().sum::<f32>() / n as f32;
        let e: Vec<f32> = raw.iter().map(|v| v - mean).collect();
        let acf0 = e.iter().map(|v| v * v).sum::<f32>() / n as f32;
        let level_frames = (self.fps as usize).min(self.rms.len());
        let level = if level_frames > 0 {
            let tail: Vec<f32> = self.rms.iter().rev().take(level_frames).copied().collect();
            (tail.iter().map(|v| v * v).sum::<f32>() / level_frames as f32).sqrt()
        } else {
            0.0
        };
        if acf0 <= 1e-9 {
            return Some(MusicBeat { bpm: 0.0, confidence: 0.0, level, last_beat_ms_ago: 0.0 });
        }

        let lag_min = (60.0 * self.fps / BPM_MAX).floor() as usize;
        let lag_max = ((60.0 * self.fps / BPM_MIN).ceil() as usize).min(n / 2);
        let acf = |lag: usize| -> f32 {
            let mut sum = 0.0;
            for t in lag..n {
                sum += e[t] * e[t - lag];
            }
            sum / (n - lag) as f32
        };
        let mut best_lag = lag_min;
        let mut best_score = f32::MIN;
        // Hasta el doble del período más largo: el puntaje de cada período
        // suma su segundo armónico (un pulso cada 2 golpes también es
        // periódico; sin esto, a 150 BPM elegía 75).
        let max_needed = (2 * lag_max + 1).min(n - 1);
        let mut values = vec![0.0f32; max_needed + 1];
        for lag in lag_min.saturating_sub(1)..=max_needed {
            values[lag] = acf(lag);
        }
        for lag in lag_min..=lag_max {
            let bpm = 60.0 * self.fps / lag as f32;
            let octaves = (bpm / BPM_PRIOR_CENTER).log2();
            let prior = (-0.5 * (octaves / BPM_PRIOR_OCTAVES_SIGMA).powi(2)).exp();
            let harmonic = values.get(2 * lag).copied().unwrap_or(0.0);
            let score = (values[lag] + 0.5 * harmonic) * prior;
            if score > best_score {
                best_score = score;
                best_lag = lag;
            }
        }
        // Afinar el período con una parábola sobre los vecinos.
        let (a, b, c) = (values[best_lag - 1], values[best_lag], values[best_lag + 1]);
        let denom = a - 2.0 * b + c;
        let offset = if denom.abs() > 1e-9 { (0.5 * (a - c) / denom).clamp(-0.5, 0.5) } else { 0.0 };
        let period = best_lag as f32 + offset;
        let bpm = 60.0 * self.fps / period;
        let confidence = (values[best_lag] / acf0).clamp(0.0, 1.0);

        // Fase: el desfase que mejor alinea un peine de golpes cada `period`
        // con la curva, contando hacia atrás desde el último cuadro.
        let mut best_phase = 0usize;
        let mut best_sum = f32::MIN;
        for phase in 0..(period.round() as usize).max(1) {
            let mut sum = 0.0;
            let mut k = 0.0f32;
            loop {
                let back = (phase as f32 + k * period).round() as usize;
                if back >= n {
                    break;
                }
                sum += raw[n - 1 - back];
                k += 1.0;
            }
            if sum > best_sum {
                best_sum = sum;
                best_phase = phase;
            }
        }
        Some(MusicBeat {
            bpm,
            confidence,
            level,
            last_beat_ms_ago: best_phase as f32 * 1000.0 / self.fps,
        })
    }
}

static STARTED: AtomicBool = AtomicBool::new(false);

// El frontend lo llama al arrancar (ver useMusicSway.ts): desde ahí se
// manda "musica" unas 4 veces por segundo.
#[tauri::command]
pub fn escuchar_musica(window: WebviewWindow) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || loop {
        let result = unsafe {
            capture_loop(&mut |beat| {
                let _ = window.emit("musica", beat);
            })
        };
        if let Err(e) = result {
            println!("[MUSICA] Captura detenida: {e:?}; se reintenta en 5 s");
            std::thread::sleep(Duration::from_secs(5));
        } else {
            // Cambió la salida de audio por defecto: se vuelve a abrir.
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

// Captura en loopback de la salida por defecto y manda una estimación cada
// 250 ms. Vuelve con Ok si cambia el dispositivo por defecto.
pub unsafe fn capture_loop(on_beat: &mut dyn FnMut(MusicBeat)) -> windows::core::Result<()> {
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
        AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
    let device_id = device.GetId()?.to_string().unwrap_or_default();
    let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;

    let pwfx = client.GetMixFormat()?;
    let fmt: WAVEFORMATEX = std::ptr::read_unaligned(pwfx);
    let channels = fmt.nChannels.max(1) as usize;
    let rate = fmt.nSamplesPerSec as f32;
    let bits = fmt.wBitsPerSample;
    // WAVE_FORMAT_IEEE_FLOAT (3), o EXTENSIBLE (0xFFFE) con SubFormat float
    // (el primer campo del GUID es 3; está a 24 bytes del principio).
    let is_float = match fmt.wFormatTag {
        3 => true,
        0xFFFE => std::ptr::read_unaligned((pwfx as *const u8).add(24) as *const u32) == 3,
        _ => false,
    };
    client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 10_000_000, 0, pwfx, None)?;
    CoTaskMemFree(Some(pwfx as *const _));
    let capture: IAudioCaptureClient = client.GetService()?;
    client.Start()?;
    println!("[MUSICA] Escuchando la salida de audio ({rate} Hz, {channels} canales, {bits} bits{}).", if is_float { ", float" } else { "" });

    let mut tracker = BeatTracker::new(rate);
    let mut mono: Vec<f32> = Vec::new();
    let started = Instant::now();
    let mut fed: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_device_check = Instant::now();

    loop {
        std::thread::sleep(Duration::from_millis(10));
        loop {
            let packet = capture.GetNextPacketSize()?;
            if packet == 0 {
                break;
            }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames: u32 = 0;
            let mut flags: u32 = 0;
            capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
            let frames_n = frames as usize;
            mono.clear();
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                mono.resize(frames_n, 0.0);
            } else if is_float && bits == 32 {
                let s = std::slice::from_raw_parts(data as *const f32, frames_n * channels);
                for f in 0..frames_n {
                    let frame = &s[f * channels..(f + 1) * channels];
                    mono.push(frame.iter().sum::<f32>() / channels as f32);
                }
            } else if bits == 16 {
                let s = std::slice::from_raw_parts(data as *const i16, frames_n * channels);
                for f in 0..frames_n {
                    let frame = &s[f * channels..(f + 1) * channels];
                    mono.push(frame.iter().map(|&v| v as f32 / 32768.0).sum::<f32>() / channels as f32);
                }
            } else {
                mono.resize(frames_n, 0.0);
            }
            capture.ReleaseBuffer(frames)?;
            tracker.push(&mono);
            fed += frames as u64;
        }
        // Cuando no suena nada, el loopback no entrega paquetes: se rellena
        // con silencio para que el análisis no se quede con la última música.
        let expected = (started.elapsed().as_secs_f64() * rate as f64) as u64;
        if expected > fed + (rate as u64 / 10) {
            let missing = (expected - fed).min(rate as u64) as usize;
            tracker.push(&vec![0.0; missing]);
            fed = expected;
        }
        if last_emit.elapsed() >= Duration::from_millis(250) {
            last_emit = Instant::now();
            if let Some(beat) = tracker.estimate() {
                on_beat(beat);
            }
        }
        if last_device_check.elapsed() >= Duration::from_secs(5) {
            last_device_check = Instant::now();
            let current = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .and_then(|d| d.GetId())
                .map(|id| id.to_string().unwrap_or_default())
                .unwrap_or_default();
            if current != device_id {
                let _ = client.Stop();
                println!("[MUSICA] Cambió la salida de audio por defecto; se reabre.");
                return Ok(());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48000.0;

    // Golpes con cuerpo de bombo (seno grave que decae) cada 60/bpm s.
    fn kicks(bpm: f32, seconds: f32) -> Vec<f32> {
        let n = (RATE * seconds) as usize;
        let period = (RATE * 60.0 / bpm) as usize;
        (0..n)
            .map(|i| {
                let t = (i % period) as f32 / RATE;
                (2.0 * std::f32::consts::PI * 60.0 * t).sin() * (-t * 25.0).exp() * 0.6
            })
            .collect()
    }

    // Ruido blanco determinista.
    fn noise(seconds: f32, amp: f32, seed: u32) -> Vec<f32> {
        let mut x = seed;
        (0..(RATE * seconds) as usize)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x as f32 / u32::MAX as f32 * 2.0 - 1.0) * amp
            })
            .collect()
    }

    // Parecido a la voz: ráfagas de ruido de largo e intervalo irregulares.
    fn speechlike(seconds: f32) -> Vec<f32> {
        let base = noise(seconds, 0.3, 7);
        let mut out = vec![0.0; base.len()];
        let mut x: u32 = 12345;
        let mut i = 0usize;
        while i < base.len() {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            let syl = (RATE * (0.08 + (x % 1000) as f32 / 1000.0 * 0.25)) as usize;
            let gap = (RATE * (0.03 + ((x >> 10) % 1000) as f32 / 1000.0 * 0.4)) as usize;
            for j in i..(i + syl).min(base.len()) {
                let env = ((j - i) as f32 / syl as f32 * std::f32::consts::PI).sin();
                out[j] = base[j] * env;
            }
            i += syl + gap;
        }
        out
    }

    fn run(signal: &[f32]) -> MusicBeat {
        let mut tracker = BeatTracker::new(RATE);
        for chunk in signal.chunks(480) {
            tracker.push(chunk);
        }
        tracker.estimate().unwrap()
    }

    #[test]
    fn tempos_de_bombo() {
        for bpm in [90.0, 120.0, 150.0] {
            let mut s = kicks(bpm, 8.0);
            let n = noise(8.0, 0.02, 3);
            for (a, b) in s.iter_mut().zip(n) {
                *a += b;
            }
            let beat = run(&s);
            println!("bombo {bpm}: {beat:?}");
            assert!((beat.bpm - bpm).abs() / bpm < 0.03, "bpm {} vs {}", beat.bpm, bpm);
            assert!(beat.confidence > 0.6, "confianza baja: {}", beat.confidence);
        }
    }

    #[test]
    fn fase_del_ultimo_golpe() {
        // 8 s a 120 BPM (un golpe cada 500 ms) + 200 ms de cola: el último
        // golpe cayó hace ~200 ms.
        let mut s = kicks(120.0, 8.0);
        s.extend(kicks(120.0, 0.2));
        let beat = run(&s);
        println!("fase: {beat:?}");
        assert!((beat.last_beat_ms_ago - 200.0).abs() < 40.0, "hace {} ms", beat.last_beat_ms_ago);
    }

    #[test]
    fn sin_pulso_confianza_baja() {
        let ruido = run(&noise(8.0, 0.3, 11));
        let voz = run(&speechlike(8.0));
        let silencio = run(&vec![0.0; (RATE * 8.0) as usize]);
        println!("ruido: {ruido:?}\nvoz: {voz:?}\nsilencio: {silencio:?}");
        // El frontend se mueve con más de 0,5 sostenido (ver useMusicSway.ts).
        assert!(ruido.confidence < 0.45);
        assert!(voz.confidence < 0.45);
        assert!(silencio.confidence == 0.0);
    }

    // Escucha la salida de audio real 12 s (poner música antes):
    // cargo test --lib music_beat::tests::escucha_real -- --ignored --nocapture
    #[test]
    #[ignore]
    fn escucha_real() {
        let started = Instant::now();
        let mut report = |beat: MusicBeat| {
            println!("{:>5.1}s  {beat:?}", started.elapsed().as_secs_f32());
        };
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_secs(12));
            std::process::exit(0);
        });
        unsafe { capture_loop(&mut report).unwrap() };
    }
}
