use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::Message};

// Tarea 8.3 (parte 2): modo stream automático -- pregunta a OBS si está
// transmitiendo o grabando, por obs-websocket (protocolo v5, viene
// integrado en OBS 28+; solo hay que activarlo en Herramientas > Ajustes
// del servidor WebSocket).
//
// La contraseña y el puerto se leen del propio archivo de configuración de
// OBS en esta PC, así Sebastián no tiene que copiarlos a mano en Miku. Se
// conecta, pregunta y se desconecta en cada consulta (el frontend consulta
// cada pocos segundos): es local y barato, y evita mantener una conexión
// viva que habría que reconectar cada vez que OBS se cierra y se abre.
#[derive(Deserialize, Default)]
struct ObsWebsocketConfig {
    #[serde(default)]
    server_enabled: bool,
    #[serde(default = "default_port")]
    server_port: u16,
    // Solo se usa si OBS pide autenticación en el Hello (ver query_obs).
    #[serde(default)]
    server_password: String,
}

fn default_port() -> u16 {
    4455
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsStatus {
    pub streaming: bool,
    pub recording: bool,
}

fn read_obs_config() -> Option<ObsWebsocketConfig> {
    let appdata = std::env::var("APPDATA").ok()?;
    let path = std::path::PathBuf::from(appdata)
        .join("obs-studio")
        .join("plugin_config")
        .join("obs-websocket")
        .join("config.json");
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn sha256_base64(input: &str) -> String {
    STANDARD.encode(Sha256::digest(input.as_bytes()))
}

async fn next_json<S>(ws: &mut S) -> Result<Value, String>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        let msg = ws
            .next()
            .await
            .ok_or("OBS cerró la conexión")?
            .map_err(|e| format!("Error leyendo de OBS: {e}"))?;
        if let Message::Text(text) = msg {
            return serde_json::from_str(text.as_str())
                .map_err(|e| format!("Respuesta inválida de OBS: {e}"));
        }
        if let Message::Close(_) = msg {
            return Err("OBS cerró la conexión (¿contraseña incorrecta?)".to_string());
        }
    }
}

async fn query_obs(config: &ObsWebsocketConfig) -> Result<ObsStatus, String> {
    let url = format!("ws://127.0.0.1:{}", config.server_port);
    let (mut ws, _) = connect_async(url.as_str())
        .await
        .map_err(|_| "OBS no está abierto (o su servidor WebSocket está apagado)".to_string())?;

    // Hello (op 0) -> Identify (op 1), con autenticación si OBS la pide.
    let hello = next_json(&mut ws).await?;
    let mut identify = json!({ "rpcVersion": 1, "eventSubscriptions": 0 });
    if let Some(auth) = hello["d"].get("authentication") {
        let challenge = auth["challenge"].as_str().unwrap_or_default();
        let salt = auth["salt"].as_str().unwrap_or_default();
        let secret = sha256_base64(&format!("{}{}", config.server_password, salt));
        identify["authentication"] = json!(sha256_base64(&format!("{secret}{challenge}")));
    }
    ws.send(Message::Text(json!({ "op": 1, "d": identify }).to_string().into()))
        .await
        .map_err(|e| format!("Error enviando a OBS: {e}"))?;

    let identified = next_json(&mut ws).await?;
    if identified["op"] != 2 {
        return Err("OBS rechazó la conexión (¿contraseña incorrecta?)".to_string());
    }

    let mut active = [false, false];
    for (i, request_type) in ["GetStreamStatus", "GetRecordStatus"].iter().enumerate() {
        let request = json!({
            "op": 6,
            "d": { "requestType": request_type, "requestId": request_type },
        });
        ws.send(Message::Text(request.to_string().into()))
            .await
            .map_err(|e| format!("Error enviando a OBS: {e}"))?;
        // Puede llegar algo que no sea la respuesta (op 7) -- se ignora.
        loop {
            let response = next_json(&mut ws).await?;
            if response["op"] == 7 && response["d"]["requestId"] == *request_type {
                active[i] = response["d"]["responseData"]["outputActive"]
                    .as_bool()
                    .unwrap_or(false);
                break;
            }
        }
    }

    let _ = ws.close(None).await;
    Ok(ObsStatus {
        streaming: active[0],
        recording: active[1],
    })
}

#[tauri::command]
pub async fn obs_estado() -> Result<ObsStatus, String> {
    let config = read_obs_config().unwrap_or_default();
    let config = ObsWebsocketConfig {
        server_port: if config.server_port == 0 { default_port() } else { config.server_port },
        ..config
    };

    match tokio::time::timeout(Duration::from_secs(3), query_obs(&config)).await {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(e)) if !config.server_enabled => Err(format!(
            "{e}. El servidor WebSocket de OBS figura desactivado: actívalo en OBS, en Herramientas > Ajustes del servidor WebSocket."
        )),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("OBS no respondió a tiempo".to_string()),
    }
}
