//! Host observations are signed by a separate, read-only host collector. No
//! network endpoint or shell supplied by an administrator is executed here.
use crate::{
    AppState,
    auth::{authenticate, enforce_operation_rate, require_role},
    error::AppError,
};
use axum::{Json, extract::State, http::HeaderMap};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use std::{net::IpAddr, path::Path, sync::Arc};
use uuid::Uuid;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub host_platform: String,
    pub server_name: String,
    pub server_address: String,
    pub installation: String,
    pub timezone: String,
    pub step: u8,
    pub vpn: VpnConfig,
    pub paths: Vec<PathMapping>,
    pub reserved_networks: Vec<String>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct VpnConfig {
    pub interface: String,
    pub address: String,
    pub port: u16,
    pub public_key: String,
    pub peers: Vec<PeerConfig>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct PeerConfig {
    pub public_key: String,
    pub endpoint: String,
    pub allowed_ips: Vec<String>,
    pub keepalive: u16,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct PathMapping {
    pub name: String,
    pub host_path: String,
    pub service_path: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Write {
    pub expected_revision: i64,
    pub config: Config,
}
pub fn enabled() -> bool {
    std::env::var("INFRASTRUCTURE_ENABLED").map_or(true, |v| v.eq_ignore_ascii_case("true"))
}
fn require_enabled() -> Result<(), AppError> {
    if enabled() {
        Ok(())
    } else {
        Err(AppError::Unavailable)
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Observation {
    pub schema: u8,
    pub observed_at: DateTime<Utc>,
    pub host_platform: String,
    pub installation: String,
    pub wireguard_installed: bool,
    pub service_state: String,
    pub interfaces: Vec<Interface>,
    pub networks: Vec<String>,
    pub network_inventory_complete: bool,
    #[serde(default)]
    pub mounts: Vec<HostMount>,
    pub errors: Vec<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HostMount {
    pub source: String,
    pub destination: String,
    pub read_only: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Interface {
    pub name: String,
    pub public_key: String,
    pub listen_port: u16,
    pub addresses: Vec<String>,
    pub peers: Vec<Peer>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Peer {
    pub public_key: String,
    pub endpoint: String,
    pub allowed_ips: Vec<String>,
    pub latest_handshake: i64,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub keepalive: u16,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    signature: String,
}

pub trait HostAdapter {
    fn platform(&self) -> &'static str;
    fn host_path(&self, path: &str) -> bool;
}
pub struct WindowsAdapter;
pub struct LinuxAdapter;
impl HostAdapter for WindowsAdapter {
    fn platform(&self) -> &'static str {
        "windows"
    }
    fn host_path(&self, path: &str) -> bool {
        let p = path.as_bytes();
        safe_path_text(path)
            && ((p.len() > 3 && p[0].is_ascii_alphabetic() && p[1] == b':' && p[2] == b'\\')
                || (path.starts_with("\\\\")
                    && path[2..].split('\\').filter(|v| !v.is_empty()).count() >= 2))
    }
}
impl HostAdapter for LinuxAdapter {
    fn platform(&self) -> &'static str {
        "linux"
    }
    fn host_path(&self, path: &str) -> bool {
        path.starts_with('/') && safe_path_text(path)
    }
}
fn safe_path_text(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 500
        && !p.chars().any(char::is_control)
        && !p.contains(['"', '\'', '`', ';', '|', '&'])
        && !p.split(['/', '\\']).any(|c| c == ".." || c == ".")
}
fn public_key(s: &str) -> bool {
    STANDARD
        .decode(s)
        .is_ok_and(|v| v.len() == 32 && v.iter().any(|b| *b != 0))
}
fn interface_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
}
fn host_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && (s.parse::<IpAddr>().is_ok()
            || s.split('.').all(|l| {
                !l.is_empty()
                    && l.len() <= 63
                    && !l.starts_with('-')
                    && !l.ends_with('-')
                    && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            }))
}
fn endpoint(s: &str) -> bool {
    if s.parse::<std::net::SocketAddr>()
        .is_ok_and(|v| v.port() > 0)
    {
        return true;
    }
    let Some((host, port)) = s.rsplit_once(':') else {
        return false;
    };
    !host.contains(['[', ']', ':']) && host_name(host) && port.parse::<u16>().is_ok_and(|v| v > 0)
}
fn same_routes(a: &[String], b: &[String]) -> bool {
    let normalized = |items: &[String]| {
        items
            .iter()
            .map(|s| network(s).map(|n| (n.bits, n.start, n.end)))
            .collect::<Option<std::collections::BTreeSet<_>>>()
    };
    match (normalized(a), normalized(b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}
#[derive(Clone, Copy)]
struct Network {
    start: u128,
    end: u128,
    bits: u8,
}
fn network(raw: &str) -> Option<Network> {
    let (ip, p) = raw.split_once('/')?;
    let ip = ip.parse::<IpAddr>().ok()?;
    let prefix = p.parse::<u8>().ok()?;
    let (n, bits) = match ip {
        IpAddr::V4(v) => (u128::from(u32::from(v)), 32),
        IpAddr::V6(v) => (u128::from(v), 128),
    };
    if prefix == 0 || prefix > bits {
        return None;
    }
    let host = bits - prefix;
    let mask = if host == 0 { 0 } else { (1u128 << host) - 1 };
    Some(Network {
        start: n & !mask,
        end: n | mask,
        bits,
    })
}
fn overlaps(a: Network, b: Network) -> bool {
    a.bits == b.bits && a.start <= b.end && b.start <= a.end
}
pub(crate) fn route_contains(raw: &str, ip: IpAddr) -> bool {
    let Some(route) = network(raw) else {
        return false;
    };
    let (n, bits) = match ip {
        IpAddr::V4(v) => (u128::from(u32::from(v)), 32),
        IpAddr::V6(v) => (u128::from(v), 128),
    };
    route.bits == bits && n >= route.start && n <= route.end
}
fn invalid() -> AppError {
    AppError::Validation("Configuración de infraestructura no válida. No se admiten claves privadas, comandos ni rutas relativas.".into())
}
fn timezone_valid(zone: &str) -> bool {
    !zone.is_empty()
        && !zone.starts_with('/')
        && !zone.contains("..")
        && zone
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-/+".contains(&b))
        && Path::new("/usr/share/zoneinfo").join(zone).is_file()
}
pub(crate) fn validate(config: &Config) -> Result<(), AppError> {
    if !matches!(
        config.host_platform.as_str(),
        "" | "windows" | "linux" | "other"
    ) || config.step > 5
        || config.server_name.len() > 100
        || config.server_name.chars().any(char::is_control)
        || (!config.server_address.is_empty() && !host_name(&config.server_address))
        || !matches!(
            config.installation.as_str(),
            "" | "physical" | "virtual_machine" | "container_host" | "unknown"
        )
        || config.timezone.len() > 100
        || config.timezone.chars().any(char::is_control)
        || (!config.timezone.is_empty() && !timezone_valid(&config.timezone))
        || config.paths.len() > 20
        || config.reserved_networks.len() > 100
        || config.vpn.peers.len() > 50
    {
        return Err(invalid());
    }
    for n in &config.reserved_networks {
        if network(n).is_none() {
            return Err(invalid());
        }
    }
    for mapping in &config.paths {
        let valid = match config.host_platform.as_str() {
            "windows" => WindowsAdapter.host_path(&mapping.host_path),
            "linux" => LinuxAdapter.host_path(&mapping.host_path),
            _ => false,
        };
        if mapping.name.is_empty()
            || mapping.name.len() > 100
            || !valid
            || !LinuxAdapter.host_path(&mapping.service_path)
        {
            return Err(invalid());
        }
    }
    let vpn = &config.vpn;
    if vpn.interface.is_empty() {
        if !vpn.address.is_empty()
            || vpn.port != 0
            || !vpn.public_key.is_empty()
            || !vpn.peers.is_empty()
        {
            return Err(invalid());
        }
    } else {
        let net = network(&vpn.address).ok_or_else(invalid)?;
        let ip: IpAddr = vpn
            .address
            .split('/')
            .next()
            .ok_or_else(invalid)?
            .parse()
            .map_err(|_| invalid())?;
        let private = match ip {
            IpAddr::V4(v) => v.is_private(),
            IpAddr::V6(v) => (v.segments()[0] & 0xfe00) == 0xfc00,
        };
        if !private
            || !interface_name(&vpn.interface)
            || vpn.port == 0
            || !public_key(&vpn.public_key)
            || config
                .reserved_networks
                .iter()
                .filter_map(|n| network(n))
                .any(|n| overlaps(net, n))
        {
            return Err(invalid());
        }
        let mut keys = std::collections::HashSet::new();
        for peer in &vpn.peers {
            if !public_key(&peer.public_key)
                || peer.public_key == vpn.public_key
                || !keys.insert(&peer.public_key)
                || (!peer.endpoint.is_empty() && !endpoint(&peer.endpoint))
                || peer.allowed_ips.is_empty()
                || peer.allowed_ips.len() > 50
                || peer.allowed_ips.iter().any(|s| network(s).is_none())
            {
                return Err(invalid());
            }
        }
        let routes: Vec<_> = vpn
            .peers
            .iter()
            .enumerate()
            .flat_map(|(i, p)| {
                p.allowed_ips
                    .iter()
                    .filter_map(move |s| network(s).map(|n| (i, n)))
            })
            .collect();
        for (i, (owner, route)) in routes.iter().enumerate() {
            if routes[i + 1..]
                .iter()
                .any(|(other, n)| owner != other && overlaps(*route, *n))
            {
                return Err(invalid());
            }
        }
    }
    Ok(())
}

fn verify_envelope(
    raw: &[u8],
    key: &[u8],
    now: DateTime<Utc>,
) -> Result<Observation, &'static str> {
    if raw.len() > 262144 || key.len() < 32 {
        return Err("INVALID_AGENT_CONFIGURATION");
    }
    let env: Envelope = serde_json::from_slice(raw).map_err(|_| "INVALID_AGENT_MESSAGE")?;
    let bytes = STANDARD
        .decode(&env.payload)
        .map_err(|_| "INVALID_AGENT_MESSAGE")?;
    let signature = STANDARD
        .decode(&env.signature)
        .map_err(|_| "INVALID_AGENT_SIGNATURE")?;
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| "INVALID_AGENT_CONFIGURATION")?;
    mac.update(&bytes);
    mac.verify_slice(&signature)
        .map_err(|_| "INVALID_AGENT_SIGNATURE")?;
    let observed: Observation =
        serde_json::from_slice(&bytes).map_err(|_| "INVALID_AGENT_MESSAGE")?;
    let age = now
        .signed_duration_since(observed.observed_at)
        .num_seconds();
    if observed.schema != 1
        || (!observed.wireguard_installed && !observed.interfaces.is_empty())
        || !matches!(observed.host_platform.as_str(), "windows" | "linux")
        || !(-15..=120).contains(&age)
        || observed.interfaces.len() > 64
        || observed.mounts.len() > 100
        || observed.mounts.iter().any(|m| {
            m.source.len() > 1000
                || m.destination.len() > 1000
                || !m.destination.starts_with('/')
                || m.source.chars().any(char::is_control)
                || m.destination.chars().any(char::is_control)
        })
        || observed.networks.len() > 200
        || observed.errors.len() > 20
        || observed.errors.iter().any(|s| {
            !matches!(
                s.as_str(),
                "WG_UNAVAILABLE"
                    | "WG_QUERY_DENIED"
                    | "NETWORK_INVENTORY_INCOMPLETE"
                    | "SERVICE_UNAVAILABLE"
            )
        })
        || observed.networks.iter().any(|s| network(s).is_none())
    {
        return Err("STALE_OR_INVALID_AGENT_MESSAGE");
    }
    for interface in &observed.interfaces {
        if !interface_name(&interface.name)
            || !public_key(&interface.public_key)
            || interface.peers.len() > 200
            || interface.addresses.iter().any(|s| network(s).is_none())
        {
            return Err("INVALID_AGENT_MESSAGE");
        }
        for peer in &interface.peers {
            if !public_key(&peer.public_key)
                || peer.latest_handshake < 0
                || peer.latest_handshake > now.timestamp() + 15
                || peer.allowed_ips.iter().any(|s| network(s).is_none())
                || (!peer.endpoint.is_empty() && !endpoint(&peer.endpoint))
            {
                return Err("INVALID_AGENT_MESSAGE");
            }
        }
    }
    Ok(observed)
}
pub async fn observation() -> Result<Observation, &'static str> {
    let key_path = std::env::var("INFRASTRUCTURE_AGENT_KEY_FILE").unwrap_or_default();
    let snapshot = std::env::var("INFRASTRUCTURE_AGENT_SNAPSHOT").unwrap_or_default();
    if key_path.is_empty() || snapshot.is_empty() {
        return Err("AGENT_NOT_CONFIGURED");
    }
    let key = tokio::fs::read(key_path)
        .await
        .map_err(|_| "AGENT_NOT_CONFIGURED")?;
    let metadata = tokio::fs::metadata(&snapshot)
        .await
        .map_err(|_| "AGENT_UNAVAILABLE")?;
    if metadata.len() > 262144 {
        return Err("INVALID_AGENT_MESSAGE");
    }
    let raw = tokio::fs::read(snapshot)
        .await
        .map_err(|_| "AGENT_UNAVAILABLE")?;
    verify_envelope(&raw, &key, Utc::now())
}
pub(crate) async fn current(state: &AppState) -> Result<(Config, i64), AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let row: Option<(Value, i64)> =
        sqlx::query_as("SELECT config,revision FROM infrastructure_config WHERE id=1")
            .fetch_optional(pool)
            .await?;
    match row {
        Some((v, r)) => Ok((
            serde_json::from_value(v).map_err(|_| AppError::Internal)?,
            r,
        )),
        None => Ok((Config::default(), 0)),
    }
}
pub(crate) fn admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<crate::auth::Claims, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin"])?;
    enforce_operation_rate(headers, &format!("infrastructure:{}", claims.profile_id))?;
    Ok(claims)
}
pub async fn get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let (config, revision) = current(&state).await?;
    let evidence:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(e) FROM (SELECT id,revision,state,checks,created_at FROM infrastructure_evidence ORDER BY created_at DESC,id LIMIT 20) e").fetch_all(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    let observation = observation().await;
    Ok(Json(
        json!({"enabled":enabled(),"config":config,"revision":revision,"runtime_platform":std::env::consts::OS,"container":Path::new("/.dockerenv").exists(),"host_platform":observation.as_ref().map(|v|v.host_platform.as_str()).ok(),"agent_state":if observation.is_ok(){"VERIFIED"}else{"BLOCKED"},"agent_error":observation.err(),"evidence":evidence}),
    ))
}
pub async fn put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<Write>,
) -> Result<Json<Value>, AppError> {
    let claims = admin(&state, &headers)?;
    require_enabled()?;
    validate(&input.config)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(724851907)")
        .execute(&mut *tx)
        .await?;
    crate::vpn_apply::ensure_idle().await?;
    let revision: Option<i64> =
        sqlx::query_scalar("SELECT revision FROM infrastructure_config WHERE id=1 FOR UPDATE")
            .fetch_optional(&mut *tx)
            .await?;
    if revision.unwrap_or(0) != input.expected_revision {
        return Err(AppError::EditConflict);
    }
    let next = input.expected_revision + 1;
    sqlx::query("INSERT INTO infrastructure_config(id,config,revision,updated_by) VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,revision=EXCLUDED.revision,updated_by=EXCLUDED.updated_by,updated_at=NOW()")
        .bind(serde_json::to_value(&input.config).map_err(|_|AppError::Internal)?).bind(next).bind(claims.profile_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO infrastructure_evidence(id,revision,state,checks,actor_id) VALUES($1,$2,'CONFIGURED',$3,$4)").bind(Uuid::new_v4()).bind(next).bind(json!({"configuration":"PASS","operation":"save","verified":false})).bind(claims.profile_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"revision":next,"config":input.config,"state":"CONFIGURED"}),
    ))
}
pub fn vpn_view(config: &Config, observed: Result<&Observation, &str>) -> Value {
    let observed = match observed {
        Ok(v) => v,
        Err(e) => {
            return json!({"state":"unknown","preparation_state":"BLOCKED","agent_state":"BLOCKED","error":e,"interface":null,"peers_count":null,"active_peers":null,"last_handshake":null,"peers":[],"host_platform":null});
        }
    };
    let selected = observed
        .interfaces
        .iter()
        .find(|i| i.name == config.vpn.interface);
    let Some(interface) = selected else {
        return json!({"state":"disconnected","preparation_state":"NOT_CONFIGURED","agent_state":"VERIFIED","host_platform":observed.host_platform,"interfaces":observed.interfaces.iter().map(|i|&i.name).collect::<Vec<_>>(),"wireguard_installed":observed.wireguard_installed,"service_state":observed.service_state,"interface":null,"peers_count":null,"active_peers":null,"last_handshake":null,"error":"INTERFACE_NOT_SELECTED_OR_UNAVAILABLE","peers":[]});
    };
    let identity = interface.public_key == config.vpn.public_key
        && interface.listen_port == config.vpn.port
        && interface.addresses.contains(&config.vpn.address);
    let now = Utc::now().timestamp();
    let active = interface
        .peers
        .iter()
        .filter(|p| {
            p.latest_handshake > 0
                && (0..=180).contains(&(now - p.latest_handshake))
                && config.vpn.peers.iter().any(|configured| {
                    configured.public_key == p.public_key
                        && same_routes(&configured.allowed_ips, &p.allowed_ips)
                })
        })
        .count();
    let connected = identity && active > 0;
    let last = interface
        .peers
        .iter()
        .filter(|p| p.latest_handshake > 0)
        .map(|p| now - p.latest_handshake)
        .min();
    json!({"state":if connected{"connected"}else{"disconnected"},"preparation_state":if connected{"ACTIVE"}else{"DISCONNECTED"},"agent_state":"VERIFIED","host_platform":observed.host_platform,"wireguard_installed":observed.wireguard_installed,"service_state":observed.service_state,"interfaces":observed.interfaces.iter().map(|i|&i.name).collect::<Vec<_>>(),"interface":interface.name,"ip_address":config.vpn.address,"public_key":interface.public_key,"listen_port":interface.listen_port,"peers_count":interface.peers.len(),"active_peers":active,"last_handshake":last,"peers":interface.peers,"observed_at":observed.observed_at,"error":if identity{None}else{Some("CONFIGURATION_RUNTIME_MISMATCH")}})
}
pub async fn vpn_status(state: &AppState) -> Result<Value, AppError> {
    let (config, _) = current(state).await?;
    let observation = observation().await;
    Ok(vpn_view(&config, observation.as_ref().map_err(|e| *e)))
}

pub async fn validate_current(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let claims = admin(&state, &headers)?;
    require_enabled()?;
    let (config, revision) = current(&state).await?;
    let observed = observation().await;
    let vpn = vpn_view(&config, observed.as_ref().map_err(|e| *e));
    let mut checks = json!({"syntax":if revision>0{"PASS"}else{"NOT_RUN"},"host": "BLOCKED", "agent":"BLOCKED", "network_conflicts":"NOT_RUN", "vpn":if config.vpn.interface.is_empty(){"NOT_RUN"}else if vpn["state"]=="connected"{"PASS"}else{"BLOCKED"},"paths":[],"destinations":[]});
    checks["infrastructure"] = json!(if !config.server_name.trim().is_empty()
        && !config.server_address.is_empty()
        && !config.installation.is_empty()
        && timezone_valid(&config.timezone)
    {
        "PASS"
    } else {
        "BLOCKED"
    });
    let dns = if config.server_address.is_empty() {
        false
    } else {
        tokio::time::timeout(
            std::time::Duration::from_secs(3),
            tokio::net::lookup_host((config.server_address.as_str(), 443)),
        )
        .await
        .is_ok_and(|r| r.is_ok_and(|mut addresses| addresses.next().is_some()))
    };
    checks["server_dns"] = json!(if dns { "PASS" } else { "BLOCKED" });
    if let Ok(observed) = &observed {
        checks["agent"] = json!("PASS");
        checks["host"] = json!(if observed.host_platform == config.host_platform {
            "PASS"
        } else {
            "FAIL"
        });
        if observed.network_inventory_complete && !config.vpn.address.is_empty() {
            let vpn_network = network(&config.vpn.address).ok_or_else(invalid)?;
            checks["network_conflicts"] = json!(if observed
                .networks
                .iter()
                .chain(config.reserved_networks.iter())
                .filter_map(|n| network(n))
                .any(|n| overlaps(vpn_network, n))
            {
                "FAIL"
            } else {
                "PASS"
            });
        }
    }
    let mut paths = Vec::new();
    for mapping in &config.paths {
        let checked =
            crate::backups::authorized_local_directory(&mapping.service_path, false).await;
        let mapped = observed.as_ref().is_ok_and(|o| {
            o.mounts.iter().any(|m| {
                let declared = mapping.host_path.replace('\\', "/");
                let actual = m.source.replace('\\', "/");
                let source_matches = if o.host_platform == "windows" {
                    declared
                        .trim_end_matches('/')
                        .eq_ignore_ascii_case(actual.trim_end_matches('/'))
                } else {
                    declared.trim_end_matches('/') == actual.trim_end_matches('/')
                };
                !m.read_only
                    && Path::new(&mapping.service_path) == Path::new(&m.destination)
                    && source_matches
            })
        });
        let passed = checked.is_ok() && mapped;
        paths.push(json!({"name":mapping.name,"result":if passed{"PASS"}else{"BLOCKED"},"detail":if passed{"Origen del montaje confirmado por el agente y acceso del servicio comprobado; valide escritura con Comprobar conexión."}else{"Falta confirmar el origen real del montaje y su acceso autorizado; guardar una ruta no acredita el mapeo."}}));
    }
    checks["paths"] = json!(paths);
    let destinations = crate::backups::infrastructure_destinations(&state).await?;
    checks["destinations"] = json!(destinations);
    let active_verified = checks["destinations"].as_array().is_some_and(|items| {
        items.iter().any(|i| i["enabled"] == true)
            && items
                .iter()
                .filter(|i| i["enabled"] == true)
                .all(|i| i["result"] == "PASS")
    });
    let ok = revision > 0
        && checks["infrastructure"] == "PASS"
        && checks["server_dns"] == "PASS"
        && checks["host"] == "PASS"
        && checks["agent"] == "PASS"
        && checks["network_conflicts"] == "PASS"
        && checks["vpn"] == "PASS"
        && paths.iter().all(|i| i["result"] == "PASS")
        && active_verified;
    let status = if ok {
        "VERIFIED"
    } else if checks["host"] == "FAIL" || checks["network_conflicts"] == "FAIL" {
        "FAILED"
    } else {
        "BLOCKED"
    };
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(724851907)")
        .execute(&mut *tx)
        .await?;
    let actual: Option<i64> =
        sqlx::query_scalar("SELECT revision FROM infrastructure_config WHERE id=1 FOR UPDATE")
            .fetch_optional(&mut *tx)
            .await?;
    if actual.unwrap_or(0) != revision {
        return Err(AppError::EditConflict);
    }
    for s in ["VALIDATING", status] {
        sqlx::query("INSERT INTO infrastructure_evidence(id,revision,state,checks,actor_id) VALUES($1,$2,$3,$4,$5)").bind(Uuid::new_v4()).bind(revision).bind(s).bind(&checks).bind(claims.profile_id).execute(&mut *tx).await?;
    }
    let service_state = if vpn["state"] == "connected" {
        if active_verified {
            "ACTIVE"
        } else {
            "DEGRADED"
        }
    } else if vpn["state"] == "disconnected" {
        "DISCONNECTED"
    } else {
        "BLOCKED"
    };
    sqlx::query("INSERT INTO infrastructure_evidence(id,revision,state,checks,actor_id) VALUES($1,$2,$3,$4,$5)").bind(Uuid::new_v4()).bind(revision).bind(service_state).bind(json!({"operation":"service_observation","scope":"vpn_and_enabled_destinations","vpn_state":vpn["state"],"agent_state":vpn["agent_state"],"observed_at":vpn["observed_at"],"all_enabled_destinations_verified":active_verified})).bind(claims.profile_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"state":status,"revision":revision,"checks":checks,"vpn":vpn}),
    ))
}
pub async fn export(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let claims = admin(&state, &headers)?;
    require_enabled()?;
    let (config, revision) = current(&state).await?;
    sqlx::query("INSERT INTO infrastructure_evidence(id,revision,state,checks,actor_id) VALUES($1,$2,'CONFIGURED',$3,$4)").bind(Uuid::new_v4()).bind(revision).bind(json!({"operation":"export_public_configuration"})).bind(claims.profile_id).execute(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    Ok(Json(
        json!({"schema":1,"revision":revision,"config":config,"secrets_included":false,"apply_automatically":false}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_are_platform_specific() {
        assert!(WindowsAdapter.host_path(r"D:\Copias"));
        assert!(WindowsAdapter.host_path(r"\\nas\copias"));
        assert!(!LinuxAdapter.host_path(r"D:\Copias"));
        assert!(!WindowsAdapter.host_path(r"D:\Copias\..\secrets"));
        assert!(!LinuxAdapter.host_path("/backups/../secrets"));
    }
    #[test]
    fn networks_reject_full_tunnel_and_detect_v4_v6_conflicts() {
        assert!(network("0.0.0.0/0").is_none());
        assert!(network("::/0").is_none());
        assert!(overlaps(
            network("10.20.1.4/24").unwrap(),
            network("10.20.0.0/16").unwrap()
        ));
        assert!(!overlaps(
            network("10.20.0.0/24").unwrap(),
            network("10.21.0.0/24").unwrap()
        ));
        assert!(overlaps(
            network("fd00:1::2/64").unwrap(),
            network("fd00::/16").unwrap()
        ));
    }
    #[test]
    fn missing_agent_never_reports_vpn_active() {
        assert_eq!(
            vpn_view(&Config::default(), Err("AGENT_UNAVAILABLE"))["state"],
            "unknown"
        );
    }
    #[test]
    fn private_key_fields_are_rejected() {
        assert!(
            serde_json::from_value::<Config>(json!({"vpn":{"private_key":"forbidden"}})).is_err()
        );
        assert!(serde_json::from_value::<Observation>(json!({"private_key":"forbidden"})).is_err());
    }
    #[test]
    fn signed_agent_requires_fresh_authentic_public_data() {
        let now = Utc::now();
        let observed = json!({"schema":1,"observed_at":now,"host_platform":"windows","installation":"unknown","wireguard_installed":false,"service_state":"unavailable","interfaces":[],"networks":[],"network_inventory_complete":false,"errors":["WG_UNAVAILABLE"]});
        let data = serde_json::to_vec(&observed).unwrap();
        let key = [1u8; 32];
        let mut mac = Hmac::<Sha256>::new_from_slice(&key).unwrap();
        mac.update(&data);
        let raw=serde_json::to_vec(&json!({"payload":STANDARD.encode(&data),"signature":STANDARD.encode(mac.finalize().into_bytes())})).unwrap();
        assert!(verify_envelope(&raw, &key, now).is_ok());
        assert!(verify_envelope(&raw, &[2u8; 32], now).is_err());
        assert!(verify_envelope(&raw, &key, now + chrono::Duration::seconds(121)).is_err());
    }
    #[test]
    fn connected_vpn_requires_identity_routes_and_recent_handshake() {
        let local = STANDARD.encode([1u8; 32]);
        let remote = STANDARD.encode([2u8; 32]);
        let config = Config {
            vpn: VpnConfig {
                interface: "corp-test".into(),
                address: "10.90.0.1/24".into(),
                port: 51999,
                public_key: local.clone(),
                peers: vec![PeerConfig {
                    public_key: remote.clone(),
                    allowed_ips: vec!["10.90.0.2/32".into()],
                    ..PeerConfig::default()
                }],
            },
            ..Config::default()
        };
        let mut observed = Observation {
            schema: 1,
            observed_at: Utc::now(),
            host_platform: "linux".into(),
            installation: "unknown".into(),
            wireguard_installed: true,
            service_state: "interfaces_available".into(),
            networks: vec![],
            network_inventory_complete: true,
            mounts: vec![],
            errors: vec![],
            interfaces: vec![Interface {
                name: "corp-test".into(),
                public_key: local,
                listen_port: 51999,
                addresses: vec!["10.90.0.1/24".into()],
                peers: vec![Peer {
                    public_key: remote,
                    endpoint: "".into(),
                    allowed_ips: vec!["10.90.0.2/32".into()],
                    latest_handshake: Utc::now().timestamp(),
                    rx_bytes: 1,
                    tx_bytes: 2,
                    keepalive: 25,
                }],
            }],
        };
        assert_eq!(vpn_view(&config, Ok(&observed))["state"], "connected");
        observed.interfaces[0].peers[0].latest_handshake = Utc::now().timestamp() - 181;
        assert_eq!(vpn_view(&config, Ok(&observed))["state"], "disconnected");
        observed.interfaces[0].peers[0].latest_handshake = Utc::now().timestamp();
        observed.interfaces[0].peers[0].allowed_ips = vec!["10.91.0.2/32".into()];
        assert_eq!(vpn_view(&config, Ok(&observed))["state"], "disconnected");
        observed.interfaces[0].public_key = STANDARD.encode([3u8; 32]);
        assert_eq!(
            vpn_view(&config, Ok(&observed))["error"],
            "CONFIGURATION_RUNTIME_MISMATCH"
        );
    }
}
