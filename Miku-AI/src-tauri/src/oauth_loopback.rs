use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

// Compartido por cualquier integración con login OAuth de escritorio
// (Spotify, Gmail, ...): captura el único request de loopback que manda el
// navegador tras la autorización, y devuelve su query string a JS. El PKCE
// en sí, y el intercambio del código por tokens, los hace cada integración
// por su lado (JS con fetch() si el proveedor permite CORS, como Spotify;
// Rust con reqwest si no está claro que lo permita, como Gmail) -- esto
// solo resuelve la parte que es imposible desde el webview: escuchar un
// puerto TCP.
//
// El comando es async y delega el bloqueo real a spawn_blocking a
// propósito (ver 6.22 del contexto): un comando de Tauri NO-async corre en
// el thread principal (el mismo que atiende la ventana) -- bloquearlo
// bloquea toda la UI. Confirmado en vivo la primera vez que se escribió
// esto para Spotify: la app se congelaba entera al apretar "Conectar
// Spotify".
#[tauri::command]
pub async fn oauth_wait_for_redirect(port: u16) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || wait_for_redirect_blocking(port))
        .await
        .map_err(|e| format!("Error interno esperando el callback de OAuth: {}", e))?
}

fn wait_for_redirect_blocking(port: u16) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("No se pudo escuchar en el puerto {}: {}", port, e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Error configurando el listener: {}", e))?;

    let start = Instant::now();
    let timeout = Duration::from_secs(180);

    loop {
        match listener.accept() {
            Ok((mut stream, _addr)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(|e| format!("Error configurando la conexión: {}", e))?;

                let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
                let mut request_line = String::new();
                reader
                    .read_line(&mut request_line)
                    .map_err(|e| format!("Error leyendo el request: {}", e))?;

                // La primera línea de un request HTTP es del tipo
                // "GET /callback?code=...&state=... HTTP/1.1".
                let path = request_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("")
                    .to_string();

                let body = "<html><body>Listo, ya puedes volver a Miku-AI. Puedes cerrar esta pestaña.</body></html>";
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                return match path.splitn(2, '?').nth(1) {
                    Some(query) => Ok(query.to_string()),
                    None => Err(
                        "El navegador no mandó ningún parámetro en el callback.".to_string(),
                    ),
                };
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if start.elapsed() > timeout {
                    return Err(
                        "Se agotó el tiempo esperando que autorices en el navegador (3 minutos)."
                            .to_string(),
                    );
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(format!("Error aceptando conexión: {}", e)),
        }
    }
}
