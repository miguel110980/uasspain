use std::{process::Stdio, sync::Arc, time::Duration};

use axum::{Json, extract::State, http::HeaderMap};
use serde_json::{Value, json};
use tokio::{process::Command, time::timeout};

use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};

pub async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    Ok(Json(platform_status().await))
}

#[cfg(windows)]
async fn platform_status() -> Value {
    let script = "Get-NetAdapter -InterfaceDescription '*WireGuard*' -ErrorAction SilentlyContinue | Select-Object -First 1 Name,Status | ConvertTo-Json -Compress";
    let Some(output) = run(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", script],
    )
    .await
    else {
        return unknown("UASSPAIN-VPN", "No se encontró ninguna interfaz WireGuard.");
    };
    let Ok(adapter) = serde_json::from_str::<Value>(&output) else {
        return unknown(
            "UASSPAIN-VPN",
            "No se pudo interpretar el estado de WireGuard.",
        );
    };
    let interface = adapter
        .get("Name")
        .and_then(Value::as_str)
        .unwrap_or("UASSPAIN-VPN");
    let connected = adapter
        .get("Status")
        .and_then(Value::as_str)
        .is_some_and(|v| v.eq_ignore_ascii_case("up"));
    json!({"state":if connected {"connected"} else {"disconnected"},"interface":interface,"ip_address":null,"public_key":null,"listen_port":null,"peers_count":0,"active_peers":0,"last_handshake":null,"peers":[],"error":null})
}

#[cfg(not(windows))]
async fn platform_status() -> Value {
    let Some(output) = run("wg", &["show", "all", "dump"]).await else {
        return unknown("wg0", "WireGuard no está instalado o no es accesible.");
    };
    let mut lines = output.lines();
    let Some(interface) = lines.next() else {
        return unknown("wg0", "No se encontró ninguna interfaz WireGuard.");
    };
    let fields: Vec<_> = interface.split('\t').collect();
    let peer_lines: Vec<_> = lines.collect();
    let active = peer_lines
        .iter()
        .filter(|line| line.split('\t').nth(4).is_some_and(|stamp| stamp != "0"))
        .count();
    json!({"state":if active > 0 {"connected"} else {"disconnected"},"interface":fields.first().copied().unwrap_or("wg0"),"ip_address":null,"public_key":fields.get(2).copied(),"listen_port":fields.get(3).and_then(|v| v.parse::<u16>().ok()),"peers_count":peer_lines.len(),"active_peers":active,"last_handshake":null,"peers":[],"error":null})
}

async fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    let output = timeout(Duration::from_secs(5), command.output())
        .await
        .ok()?
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn unknown(interface: &str, error: &str) -> Value {
    json!({"state":"unknown","interface":interface,"ip_address":null,"public_key":null,"listen_port":null,"peers_count":0,"active_peers":0,"last_handshake":null,"peers":[],"error":error})
}

#[cfg(test)]
mod tests {
    use super::unknown;

    #[test]
    fn unavailable_status_has_stable_contract() {
        let value = unknown("wg0", "missing");
        assert_eq!(value["state"], "unknown");
        assert_eq!(value["peers_count"], 0);
    }
}
