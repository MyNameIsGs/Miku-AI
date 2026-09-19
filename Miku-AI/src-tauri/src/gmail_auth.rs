use serde::{Deserialize, Serialize};

// Gmail: a diferencia de Spotify, no está documentado que el endpoint de
// token de Google (oauth2.googleapis.com/token) permita CORS desde un
// origen arbitrario como el del webview -- Google recomienda para apps
// nativas hacer el intercambio con un cliente HTTP nativo, no fetch() del
// navegador. Por eso, a diferencia de Spotify, el intercambio (y el
// refresh) se hacen acá con reqwest, no en JS. Las llamadas a la API de
// datos de Gmail (listar/leer correos) sí se hacen con fetch() desde JS,
// igual que Spotify -- esa API sí está pensada para uso desde el browser.
#[derive(Serialize)]
pub struct GmailTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

async fn post_token_request(params: &[(&str, &str)]) -> Result<GmailTokens, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(params)
        .send()
        .await
        .map_err(|e| format!("Error de red hablando con Google: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Google rechazó el pedido de token: {}", body));
    }

    let data: GoogleTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("La respuesta de Google no fue el JSON esperado: {}", e))?;

    Ok(GmailTokens {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
    })
}

#[tauri::command]
pub async fn gmail_exchange_code(
    client_id: String,
    client_secret: String,
    code: String,
    code_verifier: String,
    redirect_uri: String,
) -> Result<GmailTokens, String> {
    post_token_request(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect_uri),
        ("client_id", &client_id),
        ("client_secret", &client_secret),
        ("code_verifier", &code_verifier),
    ])
    .await
}

#[tauri::command]
pub async fn gmail_refresh_token(
    client_id: String,
    client_secret: String,
    refresh_token: String,
) -> Result<GmailTokens, String> {
    post_token_request(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh_token),
        ("client_id", &client_id),
        ("client_secret", &client_secret),
    ])
    .await
}
