// Google Maps, paso 2 (2026-09-28): la tool mi_ubicacion en la PC.
//
// Usa la ubicación de Windows (Windows.Devices.Geolocation), que se calcula
// por las redes Wi-Fi cercanas. NO la IP: la PC de Sebastián anda siempre
// con VPN y por IP saldría en Estados Unidos. Requiere que la ubicación de
// Windows esté prendida y permitida para apps de escritorio.
//
// La dirección sale de Nominatim (OpenStreetMap): gratis y sin clave; su
// política pide un User-Agent propio y no más de un pedido por segundo,
// de sobra para una tool que se usa a pedido.

use serde::Serialize;
use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator, PositionAccuracy};

#[derive(Serialize)]
pub struct Ubicacion {
    latitud: f64,
    longitud: f64,
    precision_m: f64,
    direccion: Option<String>,
}

fn leer_ubicacion() -> Result<(f64, f64, f64), String> {
    let acceso = Geolocator::RequestAccessAsync()
        .and_then(|op| op.get())
        .map_err(|e| format!("no se pudo pedir acceso a la ubicación de Windows: {e}"))?;
    if acceso != GeolocationAccessStatus::Allowed {
        return Err("la ubicación de Windows está apagada o no permitida para apps de escritorio (Configuración → Privacidad y seguridad → Ubicación)".into());
    }
    let geolocator = Geolocator::new().map_err(|e| e.to_string())?;
    let _ = geolocator.SetDesiredAccuracy(PositionAccuracy::High);
    let posicion = geolocator
        .GetGeopositionAsync()
        .and_then(|op| op.get())
        .map_err(|e| format!("Windows no pudo ubicar la PC: {e}"))?;
    let coordenada = posicion.Coordinate().map_err(|e| e.to_string())?;
    let punto = coordenada
        .Point()
        .and_then(|p| p.Position())
        .map_err(|e| e.to_string())?;
    let precision = coordenada.Accuracy().unwrap_or(0.0);
    Ok((punto.Latitude, punto.Longitude, precision))
}

async fn direccion(latitud: f64, longitud: f64) -> Option<String> {
    let url = format!(
        "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={latitud}&lon={longitud}&accept-language=es&zoom=18"
    );
    let respuesta = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "Miku-AI/1.0 (github.com/MyNameIsGs/Miku-AI)")
        .send()
        .await
        .ok()?;
    let json: serde_json::Value = respuesta.json().await.ok()?;
    json.get("display_name")?.as_str().map(str::to_string)
}

#[tauri::command]
pub async fn mi_ubicacion() -> Result<Ubicacion, String> {
    // Las llamadas de WinRT bloquean: fuera del hilo de Tauri.
    let (latitud, longitud, precision_m) = tauri::async_runtime::spawn_blocking(leer_ubicacion)
        .await
        .map_err(|e| e.to_string())??;
    Ok(Ubicacion {
        latitud,
        longitud,
        precision_m,
        direccion: direccion(latitud, longitud).await,
    })
}
