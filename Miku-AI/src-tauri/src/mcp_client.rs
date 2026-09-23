use rmcp::{
    model::CallToolRequestParams,
    service::{RoleClient, RunningService, ServiceExt},
    transport::{ConfigureCommandExt, TokioChildProcess},
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use tokio::process::Command;
use tokio::sync::Mutex;

// Tarea 8.2: Miku como cliente MCP (solo desktop) -- conecta servidores
// MCP locales (procesos que hablan por stdio, ej. `npx @playwright/mcp`)
// usando el SDK oficial `rmcp` en vez de reimplementar JSON-RPC a mano.
// Cada servidor conectado queda vivo acá mientras la app está abierta; sus
// tools se traducen al formato que espera OpenRouter del lado TypeScript
// (ver lib/mcp.ts), sin escribir código de integración específico por
// servidor -- eso es justamente el punto de conectar por MCP en vez de a
// mano como el resto de las integraciones (Spotify, Gmail, Calendar).
static MCP_CLIENTS: OnceLock<Mutex<HashMap<String, RunningService<RoleClient, ()>>>> =
    OnceLock::new();

fn clients() -> &'static Mutex<HashMap<String, RunningService<RoleClient, ()>>> {
    MCP_CLIENTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

// En Windows `npx` (y casi cualquier CLI de Node) es en realidad `npx.cmd`,
// y `Command::new("npx")` no lo encuentra: solo prueba `.exe`, no recorre
// PATHEXT -- falla con "program not found" (verificado contra
// @playwright/mcp de verdad). Pasar por `cmd /C` resuelve el nombre igual
// que una terminal. CREATE_NO_WINDOW porque la app es GUI, sin consola
// propia: sin esa bandera, cmd.exe abriría una ventana de consola visible
// mientras el servidor esté conectado.
#[cfg(windows)]
fn build_command(command: &str, args: &[String]) -> Command {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new("cmd");
    cmd.arg("/C").arg(command).args(args);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn build_command(command: &str, args: &[String]) -> Command {
    let mut cmd = Command::new(command);
    cmd.args(args);
    cmd
}

#[tauri::command]
pub async fn mcp_connect(
    server_id: String,
    command: String,
    args: Vec<String>,
) -> Result<Vec<McpToolInfo>, String> {
    // Carpeta de trabajo propia: algunos servidores escriben archivos con
    // rutas relativas (@playwright/mcp guarda ahí los snapshots de página),
    // y el directorio de la app instalada puede no tener permisos de
    // escritura.
    let work_dir = std::env::temp_dir().join("miku-mcp").join(&server_id);
    std::fs::create_dir_all(&work_dir)
        .map_err(|e| format!("No se pudo crear la carpeta de trabajo de \"{server_id}\": {e}"))?;

    let transport = TokioChildProcess::new(build_command(&command, &args).configure(|cmd| {
        cmd.current_dir(&work_dir);
    }))
    .map_err(|e| format!("No se pudo lanzar el servidor MCP \"{command}\": {e}"))?;

    let client = ()
        .serve(transport)
        .await
        .map_err(|e| format!("No se pudo conectar al servidor MCP \"{server_id}\": {e}"))?;

    let tools_result = client
        .list_tools(Default::default())
        .await
        .map_err(|e| format!("Error listando herramientas de \"{server_id}\": {e}"))?;

    let tool_infos: Vec<McpToolInfo> = tools_result
        .tools
        .iter()
        .map(|t| McpToolInfo {
            name: t.name.to_string(),
            description: t
                .description
                .clone()
                .map(|d| d.to_string())
                .unwrap_or_default(),
            input_schema: serde_json::Value::Object((*t.input_schema).clone()),
        })
        .collect();

    let mut guard = clients().lock().await;
    guard.insert(server_id, client);

    Ok(tool_infos)
}

#[tauri::command]
pub async fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    arguments_json: String,
) -> Result<String, String> {
    let guard = clients().lock().await;
    let client = guard
        .get(&server_id)
        .ok_or_else(|| format!("El servidor MCP \"{server_id}\" no está conectado."))?;

    let args: serde_json::Value = if arguments_json.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(&arguments_json)
            .map_err(|e| format!("Argumentos inválidos para \"{tool_name}\": {e}"))?
    };
    let args_map = args.as_object().cloned().unwrap_or_default();

    let result = client
        .call_tool(CallToolRequestParams::new(tool_name.clone()).with_arguments(args_map))
        .await
        .map_err(|e| format!("Error ejecutando \"{tool_name}\": {e}"))?;

    let text = result
        .content
        .iter()
        .filter_map(|c| c.as_text().map(|t| t.text.clone()))
        .collect::<Vec<_>>()
        .join("\n");

    // Por protocolo MCP, un fallo de la tool en sí (URL inválida, elemento
    // que no existe) no es un error de transporte: llega como resultado
    // normal con is_error=true. Se marca para que Miku no lo lea como éxito.
    if result.is_error == Some(true) {
        return Ok(format!("Error de la herramienta \"{tool_name}\": {text}"));
    }

    Ok(text)
}

#[tauri::command]
pub async fn mcp_disconnect(server_id: String) -> Result<(), String> {
    let mut guard = clients().lock().await;
    if let Some(client) = guard.remove(&server_id) {
        let _ = client.cancel().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_is_connected(server_id: String) -> bool {
    clients().lock().await.contains_key(&server_id)
}
