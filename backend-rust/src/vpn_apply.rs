//! Narrow, authenticated requests to the pre-authorised Windows VPN executor.
//! No shell command, path or private key is accepted from an HTTP request.
use crate::{AppState, account_lifecycle, error::AppError, infrastructure};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{net::IpAddr, path::PathBuf, sync::Arc};
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

const COMMAND_DOMAIN: &[u8] = b"UASSpain-VPN-Apply-v1\0";
const RESULT_DOMAIN: &[u8] = b"UASSpain-VPN-Apply-Result-v1\0";
const MAX_PACKET: u64 = 65536;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    signature: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Submit {
    expected_revision: i64,
    request_id: Uuid,
}
fn directory(variable: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(std::env::var(variable).map_err(|_| AppError::Unavailable)?);
    if !path.is_absolute() {
        return Err(AppError::Unavailable);
    }
    Ok(path)
}
async fn command_key() -> Result<Vec<u8>, AppError> {
    let path = directory("INFRASTRUCTURE_COMMAND_KEY_FILE")?;
    let key = fs::read(path).await.map_err(|_| AppError::Unavailable)?;
    if key.len() != 32 {
        return Err(AppError::Unavailable);
    }
    Ok(key)
}
async fn read_envelope(
    path: &std::path::Path,
    domain: &[u8],
    key: &[u8],
) -> Result<Value, AppError> {
    let metadata = fs::symlink_metadata(path)
        .await
        .map_err(|_| AppError::Unavailable)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_PACKET {
        return Err(AppError::Unavailable);
    }
    unseal(
        &fs::read(path).await.map_err(|_| AppError::Unavailable)?,
        domain,
        key,
    )
}
pub(crate) async fn ensure_idle() -> Result<(), AppError> {
    if std::env::var("INFRASTRUCTURE_REQUEST_DIRECTORY").is_err() {
        return Ok(());
    }
    let head = directory("INFRASTRUCTURE_REQUEST_DIRECTORY")?.join("head.json");
    if !fs::try_exists(&head)
        .await
        .map_err(|_| AppError::Unavailable)?
    {
        return Ok(());
    }
    let key = command_key().await?;
    let packet = read_envelope(&head, COMMAND_DOMAIN, &key).await?;
    let id = packet["request_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(AppError::Unavailable)?;
    let result = directory("INFRASTRUCTURE_RESULT_DIRECTORY")?.join(format!("{id}.json"));
    if fs::try_exists(&result)
        .await
        .map_err(|_| AppError::Unavailable)?
    {
        let result = read_envelope(&result, RESULT_DOMAIN, &key).await?;
        if result["request_id"] == json!(id)
            && matches!(
                result["state"].as_str(),
                Some("APPLIED" | "ROLLED_BACK" | "REJECTED")
            )
        {
            return Ok(());
        }
    }
    Err(AppError::Validation("Hay una aplicación de VPN pendiente. Espere su verificación o reversión antes de guardar otros cambios.".into()))
}
fn mac(domain: &[u8], payload: &[u8], key: &[u8]) -> Result<Hmac<Sha256>, AppError> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).map_err(|_| AppError::Internal)?;
    mac.update(domain);
    mac.update(payload);
    Ok(mac)
}
fn seal(value: &Value, domain: &[u8], key: &[u8]) -> Result<Vec<u8>, AppError> {
    let bytes = serde_json::to_vec(value).map_err(|_| AppError::Internal)?;
    if bytes.len() > (MAX_PACKET as usize / 2) {
        return Err(AppError::Validation(
            "Configuración de VPN demasiado grande.".into(),
        ));
    }
    let signature = mac(domain, &bytes, key)?.finalize().into_bytes();
    serde_json::to_vec(&Envelope {
        payload: STANDARD.encode(bytes),
        signature: STANDARD.encode(signature),
    })
    .map_err(|_| AppError::Internal)
}
fn unseal(raw: &[u8], domain: &[u8], key: &[u8]) -> Result<Value, AppError> {
    if raw.len() as u64 > MAX_PACKET {
        return Err(AppError::Unavailable);
    }
    let envelope: Envelope = serde_json::from_slice(raw).map_err(|_| AppError::Unavailable)?;
    let bytes = STANDARD
        .decode(envelope.payload)
        .map_err(|_| AppError::Unavailable)?;
    let signature = STANDARD
        .decode(envelope.signature)
        .map_err(|_| AppError::Unavailable)?;
    mac(domain, &bytes, key)?
        .verify_slice(&signature)
        .map_err(|_| AppError::Unavailable)?;
    serde_json::from_slice(&bytes).map_err(|_| AppError::Unavailable)
}
fn validate_scope(
    config: &infrastructure::Config,
    observed: &infrastructure::Observation,
    managed: &str,
    target: IpAddr,
) -> Result<Value, AppError> {
    infrastructure::validate(config)?;
    let invalid = || {
        AppError::Validation("La aplicación sólo puede gestionar el túnel y las identidades autorizadas del anfitrión.".into())
    };
    if observed.host_platform != "windows"
        || !observed.network_inventory_complete
        || config.vpn.interface != managed
        || managed.is_empty()
    {
        return Err(invalid());
    }
    let actual = observed
        .interfaces
        .iter()
        .find(|i| i.name == managed)
        .ok_or_else(invalid)?;
    if actual.public_key != config.vpn.public_key
        || actual.peers.len() != 1
        || config.vpn.peers.len() != 1
        || actual.peers[0].public_key != config.vpn.peers[0].public_key
    {
        return Err(invalid());
    }
    let local: IpAddr = config
        .vpn
        .address
        .split('/')
        .next()
        .ok_or_else(invalid)?
        .parse()
        .map_err(|_| invalid())?;
    if !matches!(local, IpAddr::V4(v) if v.is_private())
        || !matches!(target, IpAddr::V4(v) if v.is_private())
    {
        return Err(invalid());
    }
    let routes = &config.vpn.peers[0].allowed_ips;
    if !routes
        .iter()
        .any(|r| infrastructure::route_contains(r, target))
        || routes
            .iter()
            .any(|r| infrastructure::route_contains(r, local))
    {
        return Err(invalid());
    }
    if observed
        .networks
        .iter()
        .chain(&config.reserved_networks)
        .any(|r| infrastructure::route_contains(r, local))
    {
        return Err(AppError::Validation(
            "La IP solicitada entra en conflicto con una red local o reservada.".into(),
        ));
    }
    Ok(json!({
        "name":actual.name,"public_key":actual.public_key,"listen_port":actual.listen_port,
        "addresses":actual.addresses,
        "peers":actual.peers.iter().map(|p|json!({"public_key":p.public_key,"endpoint":p.endpoint,"allowed_ips":p.allowed_ips,"keepalive":p.keepalive})).collect::<Vec<_>>()
    }))
}
pub async fn submit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<Submit>,
) -> Result<Json<Value>, AppError> {
    let actor = infrastructure::admin(&state, &headers)?;
    if !infrastructure::enabled() {
        return Err(AppError::Unavailable);
    }
    let key = command_key().await?;
    let outbox = directory("INFRASTRUCTURE_REQUEST_DIRECTORY")?;
    let info = fs::symlink_metadata(&outbox)
        .await
        .map_err(|_| AppError::Unavailable)?;
    if !info.is_dir() || info.file_type().is_symlink() {
        return Err(AppError::Unavailable);
    }
    let observed = infrastructure::observation().await.map_err(|_| AppError::Validation("El anfitrión debe proporcionar una observación firmada y reciente antes de aplicar cambios.".into()))?;
    let (config, revision) = infrastructure::current(&state).await?;
    if revision != input.expected_revision {
        return Err(AppError::EditConflict);
    }
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(724851907)")
        .execute(&mut *tx)
        .await?;
    let locked_revision: Option<i64> =
        sqlx::query_scalar("SELECT revision FROM infrastructure_config WHERE id=1 FOR UPDATE")
            .fetch_optional(&mut *tx)
            .await?;
    if locked_revision != Some(input.expected_revision) {
        return Err(AppError::EditConflict);
    }
    ensure_idle().await?;
    account_lifecycle::actor_active(&mut tx, &actor).await?;
    let target: Option<(String,i32)> = sqlx::query_as("SELECT host(vpn_ip),sftp_port::integer FROM backups_backupserver WHERE role='external_1' AND transfer_protocol='sftp' AND vpn_ip IS NOT NULL").fetch_optional(&mut *tx).await?;
    let (target_ip, port) = target.ok_or_else(|| {
        AppError::Validation("Configure primero el destino VPN autorizado.".into())
    })?;
    if !(1..=65535).contains(&port) {
        return Err(AppError::Unavailable);
    }
    let managed =
        std::env::var("INFRASTRUCTURE_MANAGED_INTERFACE").map_err(|_| AppError::Unavailable)?;
    let expected = validate_scope(
        &config,
        &observed,
        &managed,
        target_ip.parse().map_err(|_| AppError::Unavailable)?,
    )?;
    let now = Utc::now();
    let desired_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&config.vpn).map_err(|_| AppError::Internal)?)
    );
    let command = json!({"schema":1,"action":"apply_existing_wireguard","request_id":input.request_id,
        "actor_id":actor.profile_id,"revision":revision,"issued_at":now,"expires_at":now+Duration::seconds(180),
        "config":config.vpn,"desired_hash":desired_hash,"expected":expected,"probe":{"ip":target_ip,"port":port}});
    let bytes = seal(&command, COMMAND_DOMAIN, &key)?;
    let path = outbox.join(format!("{}.json", input.request_id));
    if fs::try_exists(&path)
        .await
        .map_err(|_| AppError::Unavailable)?
    {
        return Err(AppError::EditConflict);
    }
    sqlx::query("INSERT INTO infrastructure_evidence(id,revision,state,checks,actor_id) VALUES($1,$2,'CONFIGURED',$3,$4)")
        .bind(input.request_id).bind(revision).bind(json!({"operation":"host_apply_requested","request_id":input.request_id,"desired_hash":desired_hash,"applied":false})).bind(actor.profile_id).execute(&mut *tx).await?;
    let temp = outbox.join(format!("{}.tmp", input.request_id));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .await
        .map_err(|_| AppError::Unavailable)?;
    file.write_all(&bytes)
        .await
        .map_err(|_| AppError::Unavailable)?;
    file.sync_all().await.map_err(|_| AppError::Unavailable)?;
    drop(file);
    fs::rename(temp, path)
        .await
        .map_err(|_| AppError::Unavailable)?;
    let head_temp = outbox.join(format!("{}.head.tmp", input.request_id));
    let mut head_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&head_temp)
        .await
        .map_err(|_| AppError::Unavailable)?;
    head_file
        .write_all(&bytes)
        .await
        .map_err(|_| AppError::Unavailable)?;
    head_file
        .sync_all()
        .await
        .map_err(|_| AppError::Unavailable)?;
    drop(head_file);
    fs::rename(head_temp, outbox.join("head.json"))
        .await
        .map_err(|_| AppError::Unavailable)?;
    tx.commit().await?;
    Ok(Json(
        json!({"request_id":input.request_id,"revision":revision,"state":"QUEUED","applied":false}),
    ))
}
pub async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    infrastructure::admin(&state, &headers)?;
    let root = directory("INFRASTRUCTURE_RESULT_DIRECTORY")?;
    let path = root.join(format!("{id}.json"));
    let metadata = match fs::symlink_metadata(&path).await {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Json(
                json!({"request_id":id,"state":"PENDING","applied":false}),
            ));
        }
        Err(_) => return Err(AppError::Unavailable),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_PACKET {
        return Err(AppError::Unavailable);
    }
    let value = unseal(
        &fs::read(path).await.map_err(|_| AppError::Unavailable)?,
        RESULT_DOMAIN,
        &command_key().await?,
    )?;
    if value["request_id"] != json!(id)
        || value["schema"] != 1
        || !matches!(
            value["state"].as_str(),
            Some("APPLIED" | "ROLLED_BACK" | "REJECTED")
        )
    {
        return Err(AppError::Unavailable);
    }
    if value["state"] == "APPLIED"
        && [
            "runtime_matches",
            "persisted_matches",
            "keys_preserved",
            "connectivity_verified",
        ]
        .iter()
        .any(|k| value["checks"][k] != true)
    {
        return Err(AppError::Unavailable);
    }
    Ok(Json(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authenticated_packets_reject_tampering_wrong_keys_and_other_purposes() {
        let key = [17u8; 32];
        let value = json!({"schema":1,"request_id":Uuid::new_v4(),"state":"APPLIED"});
        let packet = seal(&value, RESULT_DOMAIN, &key).unwrap();
        assert_eq!(unseal(&packet, RESULT_DOMAIN, &key).unwrap(), value);
        assert!(unseal(&packet, COMMAND_DOMAIN, &key).is_err());
        assert!(unseal(&packet, RESULT_DOMAIN, &[19u8; 32]).is_err());
        let mut tampered: Envelope = serde_json::from_slice(&packet).unwrap();
        tampered.payload = STANDARD.encode(b"{}");
        assert!(unseal(&serde_json::to_vec(&tampered).unwrap(), RESULT_DOMAIN, &key).is_err());
    }
    #[test]
    fn oversized_and_malformed_results_fail_closed() {
        assert!(
            unseal(
                &vec![b' '; MAX_PACKET as usize + 1],
                RESULT_DOMAIN,
                &[17u8; 32]
            )
            .is_err()
        );
        assert!(
            unseal(
                br#"{"payload":"!","signature":"!"}"#,
                RESULT_DOMAIN,
                &[17u8; 32]
            )
            .is_err()
        );
    }
}
