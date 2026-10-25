use crate::{error::AppError, runtime_config::SmtpConfig};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::Mailbox,
    transport::smtp::{
        authentication::Credentials,
        client::{Certificate, Tls, TlsParameters},
    },
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;

pub const AUTOMATED_FROM: &str = "no-reply@uasspain.com";
pub const FROM_NAME: &str = "UASSpain";
pub const CONTACT_RECIPIENT: &str = "info@uasspain.com";
pub const AUTOMATED_NOTICE: &str = "Este es un mensaje automático de UASSpain. Por favor, no respondas a este correo. Para cualquier consulta, contacta con info@uasspain.com";

#[derive(Clone, Deserialize, Serialize)]
pub struct Envelope {
    pub from: String,
    pub from_name: String,
    pub to: String,
    pub reply_to: Option<String>,
    pub subject: String,
    pub body: String,
    pub smtp: Option<SmtpConfig>,
}

pub fn address(value: &str) -> Result<lettre::Address, AppError> {
    if value.is_empty()
        || value.len() > 254
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(AppError::Validation(
            "Dirección de correo no válida.".into(),
        ));
    }
    value
        .parse()
        .map_err(|_| AppError::Validation("Dirección de correo no válida.".into()))
}

impl Envelope {
    pub fn message(&self) -> Result<Message, AppError> {
        self.validate()?;
        let mut message = Message::builder()
            .from(Mailbox::new(
                Some(self.from_name.clone()),
                address(&self.from)?,
            ))
            .to(Mailbox::new(None, address(&self.to)?))
            .subject(&self.subject)
            .header(lettre::message::header::ContentType::TEXT_PLAIN);
        if let Some(reply) = &self.reply_to {
            message = message.reply_to(Mailbox::new(None, address(reply)?));
        }
        message
            .body(self.body.clone())
            .map_err(|_| AppError::Internal)
    }
    pub fn validate(&self) -> Result<(), AppError> {
        address(&self.from)?;
        address(&self.to)?;
        if let Some(reply) = &self.reply_to {
            address(reply)?;
        }
        if self.from_name.len() > 120
            || self.from_name.chars().any(char::is_control)
            || self.subject.is_empty()
            || self.subject.len() > 1000
            || self.subject.chars().any(char::is_control)
            || self.body.len() > 64 * 1024
        {
            return Err(AppError::Validation("Mensaje de correo no válido.".into()));
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub enum Outcome {
    Accepted(Option<Uuid>),
    Retry(&'static str, Option<u64>),
    Failed(&'static str),
    Unknown(&'static str),
}
impl Outcome {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Accepted(_) => "",
            Self::Retry(code, _) | Self::Failed(code) | Self::Unknown(code) => code,
        }
    }
    pub fn affects_circuit(&self) -> bool {
        !matches!(self, Self::Accepted(_) | Self::Failed("recipient_invalid"))
    }
}

pub async fn smtp(envelope: &Envelope, config: &SmtpConfig, password: &str) -> Outcome {
    if !config.enabled
        || envelope.validate().is_err()
        || crate::runtime_config::validate_smtp(config).is_err()
        || password.is_empty()
    {
        return Outcome::Failed("configuration_invalid");
    }
    let message = match envelope.message() {
        Ok(message) => message,
        Err(_) => return Outcome::Failed("configuration_invalid"),
    };
    let mut tls = TlsParameters::builder(config.host.clone());
    if std::env::var("CONTACT_SMTP_HOST").ok().as_deref() == Some(config.host.as_str())
        && let Ok(path) = std::env::var("CONTACT_SMTP_CA_FILE")
        && !path.is_empty()
    {
        let certificate = std::fs::read(path)
            .ok()
            .and_then(|bytes| Certificate::from_pem(&bytes).ok());
        let Some(certificate) = certificate else {
            return Outcome::Failed("tls_configuration_invalid");
        };
        tls = tls.add_root_certificate(certificate);
    }
    let Ok(tls) = tls.build() else {
        return Outcome::Failed("tls_configuration_invalid");
    };
    let transport = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
        .port(config.port)
        .tls(if config.security == "TLS" {
            Tls::Wrapper(tls)
        } else {
            Tls::Required(tls)
        })
        .timeout(Some(Duration::from_secs(
            config.timeout_seconds.clamp(1, 60),
        )))
        .credentials(Credentials::new(config.username.clone(), password.into()))
        .build();
    match tokio::time::timeout(
        Duration::from_secs(config.timeout_seconds),
        transport.send(message),
    )
    .await
    {
        Ok(Ok(_)) => Outcome::Accepted(None),
        Ok(Err(error)) if error.is_transient() => Outcome::Retry("smtp_transient_rejection", None),
        Ok(Err(error)) if error.is_permanent() => {
            let code = error.status().map(|v| v.to_string()).unwrap_or_default();
            Outcome::Failed(if matches!(code.as_str(), "550" | "551" | "553") {
                "recipient_invalid"
            } else if matches!(code.as_str(), "530" | "534" | "535" | "538") {
                "smtp_authentication_failed"
            } else {
                "smtp_permanent_rejection"
            })
        }
        // A timeout/disconnect may follow DATA acceptance. Retain UNKNOWN and
        // never retry automatically, avoiding duplicate deliveries.
        _ => Outcome::Unknown("smtp_result_unknown"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn smtp_headers_preserve_configured_identity_and_visitor_reply_to() {
        let e = Envelope {
            from: "sender@example.invalid".into(),
            from_name: "Configured sender".into(),
            to: "contact@example.invalid".into(),
            reply_to: Some("visitor@example.invalid".into()),
            subject: "Consulta".into(),
            body: "Consulta de prueba".into(),
            smtp: None,
        };
        let wire = String::from_utf8(e.message().unwrap().formatted()).unwrap();
        // Lettre quotes display names during MIME encoding. Compare the parsed
        // wire header so valid quoting does not change the identity assertion.
        let from: lettre::message::Mailboxes = wire
            .lines()
            .find_map(|line| line.strip_prefix("From: "))
            .unwrap()
            .parse()
            .unwrap();
        let from: Vec<_> = from.into_iter().collect();
        assert_eq!(from.len(), 1);
        assert_eq!(from[0].name.as_deref(), Some("Configured sender"));
        assert_eq!(from[0].email.to_string(), "sender@example.invalid");
        assert!(wire.contains("To: contact@example.invalid"));
        assert!(wire.contains("Reply-To: visitor@example.invalid"));
        for address in [
            "a@example.invalid\r\nBcc:a@evil.invalid",
            "a@example.invalid,b@example.invalid",
            " a@example.invalid",
        ] {
            assert!(super::address(address).is_err());
        }
        let mut injected = e.clone();
        injected.from_name = "sender\nBcc: victim@example.invalid".into();
        assert!(injected.message().is_err());
        injected = e;
        injected.subject = "query\r\nBcc: victim@example.invalid".into();
        assert!(injected.message().is_err());
    }
}
