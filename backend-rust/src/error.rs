use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("authentication required")]
    Unauthorized,
    #[error("session window mismatch")]
    SessionWindowMismatch,
    #[error("session expired due to inactivity")]
    SessionIdleExpired,
    #[error("permission denied")]
    Forbidden,
    #[error("resource not found")]
    NotFound,
    #[error("content was changed by another editor")]
    EditConflict,
    #[error("{0}")]
    Validation(String),
    #[error("service temporarily unavailable")]
    Unavailable,
    #[error("login OTP delivery unavailable")]
    OtpDeliveryUnavailable,
    #[error("rate limit exceeded")]
    RateLimited,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("internal service error")]
    Internal,
}

#[derive(Serialize)]
struct ErrorBody {
    detail: String,
    code: &'static str,
    correlation_id: Uuid,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let correlation_id = Uuid::new_v4();
        let (status, code, detail) = match &self {
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "not_authenticated",
                "Credenciales no válidas.".to_owned(),
            ),
            Self::SessionWindowMismatch => (
                StatusCode::UNAUTHORIZED,
                "session_window_mismatch",
                "Acceda desde esta ventana para continuar.".to_owned(),
            ),
            Self::SessionIdleExpired => (
                StatusCode::UNAUTHORIZED,
                "session_idle_expired",
                "Tu sesión ha caducado por inactividad".to_owned(),
            ),
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                "permission_denied",
                "No tiene permiso para realizar esta acción.".to_owned(),
            ),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "not_found",
                "Recurso no encontrado.".to_owned(),
            ),
            Self::EditConflict => (
                StatusCode::CONFLICT,
                "edit_conflict",
                "El contenido ha cambiado. Actualice la lista y revise los cambios antes de guardar.".to_owned(),
            ),
            Self::Validation(message) => {
                (StatusCode::BAD_REQUEST, "validation_error", message.clone())
            }
            Self::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "service_unavailable",
                "Servicio temporalmente no disponible.".to_owned(),
            ),
            Self::OtpDeliveryUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "otp_delivery_unavailable",
                "No se ha podido enviar el código de acceso. Inténtelo de nuevo en unos instantes."
                    .to_owned(),
            ),
            Self::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                "throttled",
                "Demasiados intentos. Espere un minuto antes de reintentar.".to_owned(),
            ),
            Self::Database(error) => {
                // Avoid logging constraint details containing personal values.
                tracing::error!(%correlation_id, "database request failed");
                if error
                    .as_database_error()
                    .is_some_and(|error| error.is_unique_violation())
                {
                    (
                        StatusCode::CONFLICT,
                        "conflict",
                        "El valor ya está registrado.".to_owned(),
                    )
                } else if matches!(
                    error,
                    sqlx::Error::Io(_)
                        | sqlx::Error::Tls(_)
                        | sqlx::Error::PoolTimedOut
                        | sqlx::Error::PoolClosed
                ) {
                    (
                        StatusCode::SERVICE_UNAVAILABLE,
                        "service_unavailable",
                        "Servicio temporalmente no disponible.".to_owned(),
                    )
                } else {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "internal_error",
                        "Error interno del servicio.".to_owned(),
                    )
                }
            }
            Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Error interno del servicio.".to_owned(),
            ),
        };
        tracing::warn!(%correlation_id, status = status.as_u16(), code, "request failed");
        (
            status,
            Json(ErrorBody {
                detail,
                code,
                correlation_id,
            }),
        )
            .into_response()
    }
}
