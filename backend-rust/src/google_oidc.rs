use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use tokio::sync::RwLock;

use crate::error::AppError;

type KeyCache = RwLock<Option<(String, Instant, JwkSet)>>;
static KEYS: OnceLock<KeyCache> = OnceLock::new();

pub async fn verified_token(token: &str, client_id: &str) -> Result<serde_json::Value, AppError> {
    let header = decode_header(token).map_err(|_| AppError::Unauthorized)?;
    if header.alg != Algorithm::RS256 {
        return Err(AppError::Unauthorized);
    }
    let kid = header
        .kid
        .filter(|kid| !kid.is_empty() && kid.len() <= 200)
        .ok_or(AppError::Unauthorized)?;
    let cache = KEYS.get_or_init(|| RwLock::new(None));
    let mut cached = cache.write().await;
    let endpoint = crate::google_oauth::oidc_endpoint("certs")?;
    let refresh = cached.as_ref().is_none_or(|(source, fetched, keys)| {
        source != &endpoint
            || fetched.elapsed() > Duration::from_secs(3600)
            || (keys.find(&kid).is_none() && fetched.elapsed() > Duration::from_secs(60))
    });
    if refresh {
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| AppError::Unavailable)?
            .get(&endpoint)
            .send()
            .await
            .map_err(|_| AppError::Unavailable)?;
        if !response.status().is_success()
            || response.content_length().is_some_and(|size| size > 131072)
        {
            return Err(AppError::Unavailable);
        }
        let keys: JwkSet = response.json().await.map_err(|_| AppError::Unavailable)?;
        *cached = Some((endpoint, Instant::now(), keys));
    }
    let jwk = cached
        .as_ref()
        .and_then(|(_, _, keys)| keys.find(&kid))
        .ok_or(AppError::Unauthorized)?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| AppError::Unauthorized)?;
    drop(cached);
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);
    validation.leeway = 0;
    validation.validate_nbf = true;
    decode::<serde_json::Value>(token, &key, &validation)
        .map(|data| data.claims)
        .map_err(|_| AppError::Unauthorized)
}

#[cfg(test)]
mod tests {
    use super::verified_token;

    #[tokio::test]
    async fn rejects_unsigned_and_symmetric_tokens_before_network_access() {
        assert!(
            verified_token("eyJhbGciOiJub25lIn0.e30.", "client-id") // pragma: allowlist secret - synthetic unsigned JWT
                .await
                .is_err()
        );
        let signed = jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &serde_json::json!({"exp":9999999999_u64}),
            &jsonwebtoken::EncodingKey::from_secret(b"synthetic-test-key"),
        )
        .unwrap();
        assert!(verified_token(&signed, "client-id").await.is_err());
    }
}
