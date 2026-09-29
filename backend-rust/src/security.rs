use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};
use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::error::AppError;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub struct FieldCipher {
    current: Option<[u8; 32]>,
    previous: Option<[u8; 32]>,
}

impl FieldCipher {
    pub fn from_env() -> Result<Self, AppError> {
        Ok(Self {
            current: read_key("FIELD_ENCRYPTION_KEY", "FIELD_ENCRYPTION_KEY_FILE")?,
            previous: read_key(
                "FIELD_ENCRYPTION_KEY_PREVIOUS",
                "FIELD_ENCRYPTION_KEY_PREVIOUS_FILE",
            )?,
        })
    }

    pub fn decrypt(&self, value: &str) -> Result<String, AppError> {
        if value.is_empty() || !value.starts_with("v1:") {
            return Ok(value.to_owned());
        }
        let blob = URL_SAFE
            .decode(&value[3..])
            .map_err(|_| AppError::Internal)?;
        if blob.len() < 29 {
            return Err(AppError::Internal);
        }
        for key in [self.current.as_ref(), self.previous.as_ref()]
            .into_iter()
            .flatten()
        {
            let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| AppError::Internal)?;
            if let Ok(plaintext) = cipher.decrypt((&blob[..12]).into(), &blob[12..]) {
                return String::from_utf8(plaintext).map_err(|_| AppError::Internal);
            }
        }
        Err(AppError::Internal)
    }

    pub fn encrypt(&self, value: &str) -> Result<String, AppError> {
        if value.is_empty() || value.starts_with("v1:") {
            return Ok(value.to_owned());
        }
        let key = self.current.ok_or(AppError::Unavailable)?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| AppError::Internal)?;
        let mut nonce = [0_u8; 12];
        rand::rng().fill_bytes(&mut nonce);
        let ciphertext = cipher
            .encrypt((&nonce).into(), value.as_bytes())
            .map_err(|_| AppError::Internal)?;
        let mut blob = Vec::with_capacity(nonce.len() + ciphertext.len());
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&ciphertext);
        Ok(format!("v1:{}", URL_SAFE.encode(blob)))
    }

    pub fn blind_index(&self, normalized: &str) -> Result<String, AppError> {
        let master = self.current.ok_or(AppError::Unavailable)?;
        let mut digest = Sha256::new();
        digest.update(master);
        digest.update(b"|blind-index|v1");
        let hmac_key = digest.finalize();
        let mut mac =
            <HmacSha256 as Mac>::new_from_slice(&hmac_key).map_err(|_| AppError::Internal)?;
        mac.update(normalized.as_bytes());
        Ok(hex(&mac.finalize().into_bytes()))
    }

    /// Encrypts a backup using the compatible on-disk format: nonce then AES-GCM payload.
    pub fn encrypt_backup(&self, plaintext: &[u8]) -> Result<Vec<u8>, AppError> {
        let master = self.current.ok_or(AppError::Unavailable)?;
        let key = derive_backup_key(&master);
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| AppError::Internal)?;
        let mut nonce = [0_u8; 12];
        rand::rng().fill_bytes(&mut nonce);
        let ciphertext = cipher
            .encrypt((&nonce).into(), plaintext)
            .map_err(|_| AppError::Internal)?;
        let mut result = Vec::with_capacity(nonce.len() + ciphertext.len());
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&ciphertext);
        Ok(result)
    }

    pub fn decrypt_backup(&self, encrypted: &[u8]) -> Result<Vec<u8>, AppError> {
        if encrypted.len() < 29 {
            return Err(AppError::Validation("Backup cifrado no válido.".into()));
        }
        for key in [self.current.as_ref(), self.previous.as_ref()]
            .into_iter()
            .flatten()
        {
            // v2 usa una subclave exclusiva del dominio backup. El segundo
            // intento conserva lectura de artefactos v1 cifrados directamente
            // con la clave maestra antes de introducir esta separación.
            for candidate in [derive_backup_key(key), *key] {
                let cipher =
                    Aes256Gcm::new_from_slice(&candidate).map_err(|_| AppError::Internal)?;
                if let Ok(plaintext) = cipher.decrypt((&encrypted[..12]).into(), &encrypted[12..]) {
                    return Ok(plaintext);
                }
            }
        }
        Err(AppError::Validation(
            "No se pudo descifrar el backup con las claves configuradas.".into(),
        ))
    }

    /// Stable, non-secret identifier for the active backup key.  Manifests use
    /// it to select keys during rotation without ever storing key material.
    pub fn backup_key_id(&self) -> Result<String, AppError> {
        let master = self.current.ok_or(AppError::Unavailable)?;
        let key = derive_backup_key(&master);
        let digest = Sha256::digest(key);
        Ok(format!("aes256gcm-backup-v2:{}", hex(&digest[..8])))
    }
}

fn derive_backup_key(master: &[u8; 32]) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(master);
    digest.update(b"|uasspain|backup-encryption|v2");
    digest.finalize().into()
}

fn read_key(value_name: &str, file_name: &str) -> Result<Option<[u8; 32]>, AppError> {
    let value = std::env::var(value_name).ok().or_else(|| {
        std::env::var(file_name)
            .ok()
            .and_then(|path| std::fs::read_to_string(path).ok())
    });
    let Some(value) = value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let bytes = decode_key_material(&value)?;
    bytes.try_into().map(Some).map_err(|_| AppError::Internal)
}

fn decode_key_material(value: &str) -> Result<Vec<u8>, AppError> {
    URL_SAFE
        .decode(value)
        .or_else(|_| URL_SAFE_NO_PAD.decode(value))
        .or_else(|_| STANDARD.decode(value))
        .or_else(|_| STANDARD_NO_PAD.decode(value))
        .map_err(|_| AppError::Internal)
}

pub fn verify_password_hash(password: &str, encoded: &str) -> bool {
    if let Some(hash) = encoded.strip_prefix("argon2$") {
        use argon2::{Argon2, PasswordHash, PasswordVerifier};
        return PasswordHash::new(&format!("${hash}"))
            .ok()
            .is_some_and(|parsed| {
                Argon2::default()
                    .verify_password(password.as_bytes(), &parsed)
                    .is_ok()
            });
    }
    let mut parts = encoded.split('$');
    match (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) {
        (Some("pbkdf2_sha256"), Some(rounds), Some(salt), Some(expected), None) => {
            let Ok(rounds) = rounds.parse::<u32>() else {
                return false;
            };
            let Ok(expected) = STANDARD.decode(expected) else {
                return false;
            };
            let mut actual = vec![0_u8; expected.len()];
            pbkdf2::pbkdf2_hmac::<Sha256>(
                password.as_bytes(),
                salt.as_bytes(),
                rounds,
                &mut actual,
            );
            actual.ct_eq(&expected).into()
        }
        _ if encoded.starts_with("bcrypt_sha256$") => {
            let hash = &encoded[15..];
            let digest = hex(&Sha256::digest(password.as_bytes()));
            bcrypt::verify(digest, hash).unwrap_or(false)
        }
        _ => false,
    }
}

fn hex(bytes: &[u8]) -> String {
    const CHARS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(CHARS[usize::from(byte >> 4)]));
        output.push(char::from(CHARS[usize::from(byte & 0x0f)]));
    }
    output
}

#[cfg(test)]
mod tests {
    use base64::Engine as _;

    use super::{FieldCipher, decode_key_material, verify_password_hash};

    #[test]
    fn verifies_known_legacy_pbkdf2_sha256_hash() {
        let encoded = "pbkdf2_sha256$1000$uasspain$R64IwINkajJi3cwWJ5FAwHS7BVSp9Xyxs88Eck060Js=";
        assert!(verify_password_hash("correct horse", encoded));
        assert!(!verify_password_hash("wrong", encoded));
    }

    #[test]
    fn rejects_unknown_hashers() {
        assert!(!verify_password_hash("value", "md5$legacy"));
    }

    #[test]
    fn field_cipher_roundtrip_matches_v1_envelope() {
        let cipher = FieldCipher {
            current: Some([7; 32]),
            previous: None,
        };
        let encrypted = cipher.encrypt("mensaje privado").unwrap();
        assert!(encrypted.starts_with("v1:"));
        assert_eq!(cipher.decrypt(&encrypted).unwrap(), "mensaje privado");
    }

    #[test]
    fn encryption_key_accepts_standard_and_urlsafe_base64() {
        let key = [251_u8; 32];
        let standard = base64::engine::general_purpose::STANDARD.encode(key);
        let urlsafe = base64::engine::general_purpose::URL_SAFE.encode(key);
        assert_eq!(decode_key_material(&standard).unwrap(), key);
        assert_eq!(decode_key_material(&urlsafe).unwrap(), key);
    }
}
