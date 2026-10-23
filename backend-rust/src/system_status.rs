use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
    runtime_config,
};
use axum::{
    Json,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, header::HOST},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    net::SocketAddr,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Serialize)]
pub struct SystemStatusResponse {
    pub platform: PlatformStatus,
    pub backend: BackendStatus,
    pub database: DatabaseStatus,
    pub redis: RedisStatus,
    pub websockets: WebsocketStatus,
    pub smtp: Value,
    pub mail: Value,
    pub google_oauth: Value,
    pub users: UserCounts,
    pub academic: AcademicCounts,
    pub security: Value,
    pub two_factor: Value,
    pub host: Value,
}
#[derive(Serialize)]
pub struct PlatformStatus {
    pub name: &'static str,
    pub production: bool,
    pub frontend_url: String,
    pub timezone: &'static str,
    pub database_connected: bool,
}
#[derive(Serialize)]
pub struct BackendStatus {
    pub status: &'static str,
    pub runtime: &'static str,
    pub uptime_seconds: u64,
}
#[derive(Serialize)]
pub struct DatabaseStatus {
    pub status: &'static str,
    pub connected: bool,
}
#[derive(Serialize)]
pub struct RedisStatus {
    pub status: &'static str,
    pub configured: bool,
    pub connected: bool,
    pub backend: &'static str,
}
#[derive(Serialize)]
pub struct WebsocketStatus {
    pub status: &'static str,
    pub backend: &'static str,
    pub operational: bool,
}
#[derive(Default, Serialize, sqlx::FromRow)]
pub struct UserCounts {
    pub total: i64,
    pub unique_active: i64,
    pub admin: i64,
    pub instructor: i64,
    pub alumno: i64,
}
pub const ROLE_COUNTS_SQL: &str = "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='activo') AS unique_active, COUNT(*) FILTER (WHERE status='activo' AND (role='admin' OR roles @> '[\"admin\"]'::jsonb)) AS admin, COUNT(*) FILTER (WHERE status='activo' AND (role='instructor' OR roles @> '[\"instructor\"]'::jsonb)) AS instructor, COUNT(*) FILTER (WHERE status='activo' AND (role='alumno' OR roles @> '[\"alumno\"]'::jsonb)) AS alumno FROM accounts_userprofile";

#[derive(Serialize, sqlx::FromRow)]
pub struct AcademicCounts {
    pub published_courses: i64,
    pub published_news: i64,
    pub available_exams: i64,
    pub total_exams: i64,
    pub published_materials: i64,
    pub total_materials: i64,
    pub exam_results: i64,
    pub passed_exams: i64,
}

pub async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<SystemStatusResponse>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    let database_connected = runtime_config::database_probe(&state).await;
    let users = sqlx::query_as::<_, UserCounts>(ROLE_COUNTS_SQL)
        .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await?;
    let academic = sqlx::query_as::<_, AcademicCounts>("SELECT (SELECT COUNT(*) FROM courses WHERE status='published') AS published_courses, (SELECT COUNT(*) FROM blog_posts WHERE status='published') AS published_news, (SELECT COUNT(*) FROM examenes_examen WHERE activo) AS available_exams, (SELECT COUNT(*) FROM examenes_examen) AS total_exams, (SELECT COUNT(*) FROM materiales_material WHERE activo) AS published_materials, (SELECT COUNT(*) FROM materiales_material) AS total_materials, (SELECT COUNT(*) FROM examenes_resultadoexamen) AS exam_results, (SELECT COUNT(*) FROM examenes_resultadoexamen WHERE aprobado) AS passed_exams")
        .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    let configured = state.events.configured();
    let connected = state.events.connected();
    let backend = if configured { "redis" } else { "inmemory" };
    let operational = connected || !configured;
    let (smtp, password) = runtime_config::smtp(&state).await?;
    let google = runtime_config::google(&state).await?;
    let status = SystemStatusResponse {
        platform: PlatformStatus {
            name: "UASSPAIN",
            production: runtime_config::env_true("APP_PRODUCTION"),
            frontend_url: std::env::var("FRONTEND_URL").unwrap_or_default(),
            timezone: "Europe/Madrid",
            database_connected,
        },
        backend: BackendStatus {
            status: if database_connected && operational {
                "ok"
            } else {
                "error"
            },
            runtime: "rust",
            uptime_seconds: state.started.elapsed().as_secs(),
        },
        database: DatabaseStatus {
            status: if database_connected { "ok" } else { "error" },
            connected: database_connected,
        },
        redis: RedisStatus {
            status: if connected {
                "ok"
            } else if configured {
                "error"
            } else {
                "not_configured"
            },
            configured,
            connected,
            backend,
        },
        websockets: WebsocketStatus {
            status: if operational { "ok" } else { "error" },
            backend,
            operational,
        },
        smtp: runtime_config::smtp_view(&smtp, password.as_deref()),
        mail: json!({"api_exclusive":crate::mail_config::api_exclusive(&state).await?,"provider":"postmark","api_key_configured":crate::mail_config::token(&state,false).await?.is_some(),"api_sender_verified":crate::mail_config::api_config(&state,false).await?.verified_at.is_some()}),
        google_oauth: runtime_config::google_view(google),
        users,
        academic,
        security: json!({"jwt_cookie_secure":state.tokens.secure_cookie,"reverse_proxy":std::env::var("REVERSE_PROXY").unwrap_or_default(),"trust_proxy":runtime_config::env_true("TRUST_PROXY")&&!std::env::var("TRUSTED_PROXY_HOST").unwrap_or_default().is_empty(),"allowed_hosts":state.allowed_hosts,"tls_pending_hosts":tls_pending_hosts(),"cors_origins":std::env::var("CORS_ALLOWED_ORIGINS").unwrap_or_default().split(',').map(str::trim).filter(|v|!v.is_empty()).collect::<Vec<_>>(),"google_public_origin":crate::google_oauth::trusted_origin().ok(),"csp":true,"hsts":state.tokens.secure_cookie}),
        two_factor: runtime_config::setting(&state, "auth_policy")
            .await?
            .unwrap_or_else(|| json!({"enabled":false,"required_roles":[]})),
        host: resources().await,
    };
    Ok(Json(status))
}
fn parse_allowed_hosts(config: &str) -> Vec<String> {
    config
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('#').next()?.split_whitespace();
            let host = fields.next()?;
            (fields.next() == Some("1;")
                && fields.next().is_none()
                && host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-'))
            .then(|| host.to_owned())
        })
        .collect()
}
fn tls_pending_hosts() -> Option<Vec<String>> {
    std::env::var("TLS_PENDING_HOSTS_FILE")
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|source| parse_allowed_hosts(&source))
}

pub(crate) fn allowed_hosts() -> Vec<String> {
    match std::env::var("ALLOWED_HOSTS_FILE") {
        Ok(path) => std::fs::read_to_string(path)
            .map(|config| parse_allowed_hosts(&config))
            .unwrap_or_default(), // A configured but unreadable allowlist denies all requests.
        Err(_) => vec!["localhost".into(), "127.0.0.1".into()], // Local development only.
    }
}

fn host_is_allowed(value: &str, allowed: &[String]) -> bool {
    let host = match value.split_once(':') {
        Some((host, port)) => {
            if port.is_empty()
                || !port.bytes().all(|b| b.is_ascii_digit())
                || port.parse::<u16>().is_err()
            {
                return false;
            }
            host
        }
        None => value,
    };
    !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        && allowed.iter().any(|entry| entry.eq_ignore_ascii_case(host))
}

pub async fn validate_host(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let mut hosts = request.headers().get_all(HOST).iter();
    let header = hosts.next();
    let authority = request.uri().authority().map(|value| value.as_str());
    let host = match header {
        Some(value) => value.to_str().ok(),
        None => authority, // HTTP/2 may supply :authority without a Host header.
    };
    let conflicting_authority = match (header, authority) {
        (Some(value), Some(authority)) => value
            .to_str()
            .map_or(true, |value| !value.eq_ignore_ascii_case(authority)),
        _ => false,
    };
    if hosts.next().is_some()
        || conflicting_authority
        || !host.is_some_and(|host| host_is_allowed(host, &state.allowed_hosts))
    {
        return AppError::Validation("Host no permitido.".into()).into_response();
    }
    next.run(request).await
}

pub async fn sanitize_proxy_headers(mut request: Request, next: Next) -> Response {
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0.ip());
    let trusted = if runtime_config::env_true("TRUST_PROXY") {
        if let (Some(peer), Ok(host)) = (peer, std::env::var("TRUSTED_PROXY_HOST")) {
            match tokio::time::timeout(
                Duration::from_secs(1),
                tokio::net::lookup_host((host.as_str(), 443)),
            )
            .await
            {
                Ok(Ok(mut addrs)) => addrs.any(|addr| addr.ip() == peer),
                _ => false,
            }
        } else {
            false
        }
    } else {
        false
    };
    if !trusted {
        for header in [
            "x-forwarded-for",
            "x-forwarded-proto",
            "x-forwarded-host",
            "x-real-ip",
            "forwarded",
        ] {
            request.headers_mut().remove(header);
        }
    }
    next.run(request).await
}
async fn resources() -> Value {
    let read = |path: &str| std::fs::read_to_string(path).ok();
    let mem = read("/sys/fs/cgroup/memory.current").and_then(|s| s.trim().parse::<f64>().ok());
    let limit = read("/sys/fs/cgroup/memory.max").and_then(|s| s.trim().parse::<f64>().ok());
    let usage = read("/sys/fs/cgroup/cpu.stat").and_then(|s| {
        s.lines()
            .find_map(|l| l.strip_prefix("usage_usec ")?.parse::<f64>().ok())
    });
    let cores = read("/sys/fs/cgroup/cpu.max")
        .and_then(|s| {
            let mut parts = s.split_whitespace();
            let quota = parts.next()?.parse::<f64>().ok()?;
            let period = parts.next()?.parse::<f64>().ok()?;
            (period > 0.0).then_some(quota / period)
        })
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(1.0, |n| n.get() as f64));
    static SAMPLE: OnceLock<Mutex<Option<(Instant, f64)>>> = OnceLock::new();
    let cpu_percent = usage.and_then(|usage| {
        let mut sample = SAMPLE.get_or_init(|| Mutex::new(None)).lock().ok()?;
        let now = Instant::now();
        let percent = sample.and_then(|(then, last)| {
            let dt = now.duration_since(then).as_secs_f64();
            (dt > 0.01)
                .then_some(((usage - last) / 1_000_000.0 / dt / cores * 100.0).clamp(0.0, 100.0))
        });
        *sample = Some((now, usage));
        percent
    });
    let disk = match tokio::time::timeout(
        Duration::from_secs(2),
        tokio::process::Command::new("df")
            .args(["-Pk", "/app/backups"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    {
        Ok(Ok(output)) if output.status.success() => {
            String::from_utf8(output.stdout).ok().and_then(|s| {
                let line = s.lines().nth(1)?;
                let parts: Vec<_> = line.split_whitespace().collect();
                Some((
                    parts.get(1)?.parse::<f64>().ok()? * 1024.0,
                    parts.get(2)?.parse::<f64>().ok()? * 1024.0,
                ))
            })
        }
        _ => None,
    };
    let memory = match (mem, limit) {
        (Some(used), Some(total)) if total > 0.0 => {
            json!({"status":"ok","percent":(used/total*100.0).round(),"used_gb":used/1_073_741_824.0,"total_gb":total/1_073_741_824.0})
        }
        _ => json!({"status":"warn","percent":null,"used_gb":null,"total_gb":null}),
    };
    let disk = match disk {
        Some((total, used)) if total > 0.0 => {
            json!({"status":"ok","percent":(used/total*100.0).round(),"used_gb":used/1_073_741_824.0,"total_gb":total/1_073_741_824.0,"available_gb":(total-used)/1_073_741_824.0,"path":"/app/backups"})
        }
        _ => {
            json!({"status":"warn","percent":null,"used_gb":null,"total_gb":null,"path":"/app/backups"})
        }
    };
    json!({"available":mem.is_some()||disk["percent"].is_number(),"scope":"Recursos del entorno Docker","cpu":{"status":if cpu_percent.is_some(){"ok"}else{"warn"},"percent":cpu_percent,"cores":cores},"memory":memory,"disk":disk})
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn untrusted_peer_cannot_supply_forwarded_headers() {
        use axum::{Router, body::Body, http::Request, middleware, routing::get};
        use tower::ServiceExt;
        let app = Router::new()
            .route(
                "/",
                get(|headers: axum::http::HeaderMap| async move {
                    let spoofed = [
                        "x-forwarded-for",
                        "x-forwarded-proto",
                        "x-forwarded-host",
                        "x-real-ip",
                        "forwarded",
                    ]
                    .iter()
                    .any(|name| headers.contains_key(*name));
                    axum::Json(serde_json::json!({
                        "spoofed": spoofed,
                        "origin": headers.get("origin").and_then(|v| v.to_str().ok())
                    }))
                }),
            )
            .layer(middleware::from_fn(super::sanitize_proxy_headers));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("origin", "https://localhost")
                    .header("x-forwarded-for", "203.0.113.8")
                    .header("x-forwarded-proto", "https")
                    .header("x-forwarded-host", "localhost")
                    .header("x-real-ip", "203.0.113.8")
                    .header("forwarded", "for=203.0.113.8")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["spoofed"], false);
        assert_eq!(result["origin"], "https://localhost");
    }

    #[test]
    fn status_uses_the_literal_hosts_allowed_by_nginx() {
        assert_eq!(
            super::parse_allowed_hosts(
                "# shared\nlocalhost 1;\n127.0.0.1 1; # local\ndefault 0;\n~.* 1;\nexample.test 0;\n"
            ),
            ["localhost", "127.0.0.1"]
        );
    }

    #[tokio::test]
    async fn shared_host_allowlist_is_enforced_by_the_backend() {
        use axum::{
            body::Body,
            http::{Request, StatusCode},
        };
        use tower::ServiceExt;

        let mut state = crate::AppState::for_test();
        state.allowed_hosts = super::parse_allowed_hosts(
            "localhost 1;\n127.0.0.1 1;\nuasspain.com 1;\nwww.uasspain.com 1;\nuasspain-prueba.duckdns.org 1;\nwww.uasspain-prueba.duckdns.org 1;\n",
        );
        assert_eq!(
            state.allowed_hosts,
            [
                "localhost",
                "127.0.0.1",
                "uasspain.com",
                "www.uasspain.com",
                "uasspain-prueba.duckdns.org",
                "www.uasspain-prueba.duckdns.org"
            ]
        );
        let app = crate::app::build_router(std::sync::Arc::new(state));
        for (host, expected) in [
            ("localhost", StatusCode::OK),
            ("127.0.0.1", StatusCode::OK),
            ("uasspain.com", StatusCode::OK),
            ("www.uasspain.com", StatusCode::OK),
            ("uasspain-prueba.duckdns.org", StatusCode::OK),
            ("www.uasspain-prueba.duckdns.org", StatusCode::OK),
            ("localhost:8445", StatusCode::OK),
            ("127.0.0.1:8445", StatusCode::OK),
            ("uasspain.com:443", StatusCode::OK),
            ("www.uasspain.com:443", StatusCode::OK),
            ("LOCALHOST:8445", StatusCode::OK),
            ("WWW.UASSPAIN.COM", StatusCode::OK),
            ("uas-spain.com", StatusCode::BAD_REQUEST),
            ("www.uas-spain.com", StatusCode::BAD_REQUEST),
            ("evil-uasspain.com", StatusCode::BAD_REQUEST),
            ("uasspain.com.evil.com", StatusCode::BAD_REQUEST),
            ("random.example.com", StatusCode::BAD_REQUEST),
            ("0.0.0.0", StatusCode::BAD_REQUEST),
            ("*", StatusCode::BAD_REQUEST),
            ("", StatusCode::BAD_REQUEST),
            ("localhost:", StatusCode::BAD_REQUEST),
            ("localhost:abc", StatusCode::BAD_REQUEST),
            ("localhost:65536", StatusCode::BAD_REQUEST),
            ("localhost:443:80", StatusCode::BAD_REQUEST),
            ("localhost@random.example.com", StatusCode::BAD_REQUEST),
            ("localhost/path", StatusCode::BAD_REQUEST),
            (" localhost", StatusCode::BAD_REQUEST),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/api/health/live/")
                        .header("host", host)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected, "Host: {host}");
        }
    }
}
