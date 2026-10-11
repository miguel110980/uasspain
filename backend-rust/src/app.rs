use std::{collections::HashMap, sync::Arc, time::Instant};

use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderName, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use sqlx::PgPool;
use tokio::sync::RwLock;
use tower_http::{
    catch_panic::CatchPanicLayer,
    cors::CorsLayer,
    limit::RequestBodyLimitLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

use crate::{
    api, auth, chat, db, error::AppError, exam_admin, exams, materials, security::FieldCipher,
    users,
};

pub struct AppState {
    pub pool: Option<PgPool>,
    pub tokens: auth::TokenService,
    pub cipher: FieldCipher,
    pub events: crate::cache::EventBus,
    pub restores: Arc<RwLock<HashMap<uuid::Uuid, serde_json::Value>>>,
    pub started: Instant,
    pub allowed_hosts: Vec<String>,
}

impl AppState {
    pub async fn from_env() -> Result<Self, AppError> {
        let pool = db::connect_from_env().await?;
        let cipher = FieldCipher::from_env()?;
        if let Some(database) = &pool {
            db::ensure_bootstrap_admin(database, &cipher).await?;
        }
        Ok(Self {
            pool,
            tokens: auth::TokenService::from_env()?,
            cipher,
            events: crate::cache::EventBus::from_env().await?,
            restores: Arc::new(RwLock::new(HashMap::new())),
            started: Instant::now(),
            allowed_hosts: crate::system_status::allowed_hosts(),
        })
    }

    #[cfg(test)]
    pub fn for_test() -> Self {
        Self {
            pool: None,
            tokens: auth::TokenService::for_test(),
            cipher: FieldCipher::from_env().expect("test cipher"),
            events: crate::cache::EventBus::default(),
            restores: Arc::new(RwLock::new(HashMap::new())),
            started: Instant::now(),
            allowed_hosts: vec!["localhost".into(), "127.0.0.1".into()],
        }
    }
}

pub fn build_router(state: Arc<AppState>) -> Router {
    let request_id = HeaderName::from_static("x-request-id");
    let cors = cors_layer();
    Router::new()
        .route("/", get(api::root))
        .route(
            "/api/admin/content/images",
            get(crate::content_images::list),
        )
        .route("/api/health/live/", get(api::live))
        .route("/api/health/ready/", get(api::ready))
        .route("/api/public/stats/", get(api::public_stats))
        .route("/api/public/oauth/google/", get(api::public_google_oauth))
        .route("/api/public/publicaciones/", get(api::public_publications))
        .route(
            "/api/public/content/versions/",
            get(crate::content_realtime::revisions),
        )
        .route(
            "/api/admin/content/{kind}/order",
            post(crate::content_realtime::reorder),
        )
        .route("/ws/public-content/", get(crate::content_realtime::socket))
        .route("/api/services", get(crate::services::public_list))
        .route("/api/services/{slug}", get(crate::services::public_detail))
        .route(
            "/api/public/seo/service-route/{slug}",
            get(crate::seo::service_route),
        )
        .route(
            "/api/public/seo/service-head/{slug}",
            get(crate::seo::service_head),
        )
        .route(
            "/api/public/seo/service-body/{slug}",
            get(crate::seo::service_body),
        )
        .route(
            "/api/public/seo/sitemap-services.xml",
            get(crate::seo::service_sitemap),
        )
        .route(
            "/api/admin/services",
            get(crate::services::admin_list).post(crate::services::create),
        )
        .route(
            "/api/admin/services/{id}",
            axum::routing::patch(crate::services::update).delete(crate::services::delete),
        )
        .route(
            "/api/admin/services/{id}/image",
            post(crate::services::upload_image).layer(DefaultBodyLimit::max(10 * 1024 * 1024)),
        )
        .route("/api/blog/posts", get(crate::content::public_posts))
        .route("/api/blog/posts/{id}", get(crate::content::public_post))
        .route("/api/courses", get(crate::content::public_courses))
        .route("/api/courses/{*slug}", get(crate::content::public_course))
        .route(
            "/api/public/seo/course-route/{*slug}",
            get(crate::seo::course_route),
        )
        .route(
            "/api/public/seo/course-head/{*slug}",
            get(crate::seo::course_head),
        )
        .route(
            "/api/public/seo/course-body/{*slug}",
            get(crate::seo::course_body),
        )
        .route(
            "/api/public/seo/sitemap-courses.xml",
            get(crate::seo::course_sitemap),
        )
        .route(
            "/api/admin/blog/posts",
            get(crate::content::admin_posts).post(crate::content::create_post),
        )
        .route(
            "/api/admin/blog/posts/{id}",
            axum::routing::patch(crate::content::update_post).delete(crate::content::delete_post),
        )
        .route(
            "/api/admin/blog/posts/{id}/images",
            post(crate::content::add_post_image).layer(DefaultBodyLimit::max(10 * 1024 * 1024)),
        )
        .route(
            "/api/admin/blog/posts/{post_id}/images/{image_id}",
            axum::routing::delete(crate::content::delete_post_image),
        )
        .route(
            "/api/admin/courses",
            get(crate::content::admin_courses).post(crate::content::create_course),
        )
        .route(
            "/api/admin/courses/{id}",
            axum::routing::patch(crate::content::update_course)
                .delete(crate::content::delete_course),
        )
        .route(
            "/api/admin/courses/{id}/cover",
            post(crate::content::upload_course_cover)
                .layer(DefaultBodyLimit::max(10 * 1024 * 1024)),
        )
        .route(
            "/api/admin/courses/{id}/sections",
            post(crate::content::create_section),
        )
        .route(
            "/api/admin/courses/{course_id}/sections/{section_id}",
            axum::routing::patch(crate::content::update_section)
                .delete(crate::content::delete_section),
        )
        .route(
            "/api/contact/",
            post(crate::contact::send).layer(DefaultBodyLimit::max(16 * 1024)),
        )
        .route("/api/contact/config/", get(crate::contact::public_config))
        .route("/api/system/status/", get(crate::system_status::status))
        .route("/api/dashboard/counts/", get(crate::dashboard::counts))
        .route(
            "/api/system/smtp/",
            get(crate::runtime_config::smtp_get).put(crate::runtime_config::smtp_put),
        )
        .route(
            "/api/system/smtp/test/",
            post(crate::runtime_config::smtp_test),
        )
        .route(
            "/api/system/google-oauth/",
            get(crate::runtime_config::google_get).put(crate::runtime_config::google_put),
        )
        .route("/api/vpn/status/", get(crate::vpn::status))
        .route(
            "/api/system/auth-policy/",
            get(api::auth_policy_get).put(api::auth_policy_put),
        )
        .route("/api/auth/login/", post(auth::login))
        .route("/api/auth/context/", post(auth::browser_context))
        .route(
            "/api/auth/activity/",
            get(auth::activity).post(auth::activity),
        )
        .route("/api/auth/google/", post(auth::google_login))
        .route("/api/auth/google/challenge/", post(auth::google_challenge))
        .route("/api/auth/refresh/", post(auth::refresh))
        .route("/api/auth/logout/", post(auth::logout))
        .route("/api/auth/me/", get(auth::me))
        .route("/api/auth/session-role/", post(auth::session_role))
        .route("/api/auth/register/", post(crate::registration::register))
        .route(
            "/api/auth/verify-otp/",
            post(crate::registration::verify_otp),
        )
        .route(
            "/api/auth/resend-otp/",
            post(crate::registration::resend_otp),
        )
        .route(
            "/api/auth/change-password/",
            post(crate::registration::change_password),
        )
        .route(
            "/api/auth/password-reset/",
            post(crate::registration::password_reset_request),
        )
        .route(
            "/api/auth/password-reset/confirm/",
            post(crate::registration::password_reset_confirm),
        )
        .route(
            "/api/users/crear-instructor/",
            post(crate::registration::create_instructor),
        )
        .route("/api/users/invite/", post(crate::registration::invite_user))
        .route(
            "/api/users/{id}/reset-password/",
            post(crate::registration::admin_password_reset),
        )
        .route("/api/profiles/", get(users::list))
        .route(
            "/api/profiles/{id}/",
            get(users::detail)
                .patch(users::update)
                .delete(users::delete),
        )
        .route("/api/profiles/instructores/", get(users::instructors))
        .route(
            "/api/profiles/{id}/assigned-alumnos/",
            get(users::assigned_students),
        )
        .route(
            "/api/profiles/{id}/assign-alumnos/",
            post(users::assign_students),
        )
        .route(
            "/api/profiles/{id}/unassign-alumnos/",
            post(users::unassign_students),
        )
        .route(
            "/api/instructor/access/{id}/",
            get(crate::instructor_access::list),
        )
        .route(
            "/api/instructor/access/toggle/",
            post(crate::instructor_access::toggle),
        )
        .route(
            "/api/examenes/",
            get(exams::list_exams).post(exam_admin::create_exam),
        )
        .route(
            "/api/examenes/{id}/",
            get(exams::exam_detail)
                .patch(exam_admin::update_exam)
                .delete(exam_admin::delete_exam),
        )
        .route("/api/examenes/{id}/intentos/", post(exams::start_attempt))
        .route(
            "/api/intentos-examen/{id}/",
            axum::routing::put(exams::save_answers),
        )
        .route(
            "/api/examenes/importar-pdf/",
            post(crate::exam_import::import),
        )
        .route(
            "/api/preguntas/",
            get(exams::list_questions).post(exam_admin::create_question),
        )
        .route(
            "/api/preguntas/{id}/",
            get(exams::question_detail)
                .patch(exam_admin::update_question)
                .delete(exam_admin::delete_question),
        )
        .route(
            "/api/resultados-examen/",
            get(exams::list_results).post(exams::submit_result),
        )
        .route(
            "/api/resultados-examen/{id}/",
            get(exams::result_detail).delete(exams::delete_result),
        )
        .route(
            "/api/resultados-examen/delete-many/",
            post(exam_admin::delete_results_many),
        )
        .route(
            "/api/resultados-practico/",
            get(exam_admin::list_practical).post(exam_admin::create_practical),
        )
        .route(
            "/api/resultados-practico/{id}/",
            axum::routing::patch(exam_admin::update_practical).delete(exam_admin::delete_practical),
        )
        .route(
            "/api/bloqueos-examen/",
            get(exam_admin::list_blocks).post(exam_admin::create_block),
        )
        .route(
            "/api/bloqueos-examen/delete-many/",
            post(exam_admin::delete_blocks_many),
        )
        .route(
            "/api/bloqueos-examen/{id}/",
            axum::routing::patch(exam_admin::update_block).delete(exam_admin::delete_block),
        )
        .route(
            "/api/archivos-examen/",
            get(exam_admin::list_archives).post(exam_admin::create_archive),
        )
        .route(
            "/api/archivos-examen/{id}/",
            get(exam_admin::archive_detail)
                .patch(exam_admin::update_archive)
                .delete(exam_admin::delete_archive),
        )
        .route(
            "/api/materiales/",
            get(materials::list_materials).post(materials::create_material),
        )
        .route(
            "/api/materiales/{id}/",
            get(materials::material_detail)
                .patch(materials::update_material)
                .delete(materials::delete_material),
        )
        .route(
            "/api/materiales-completados/",
            get(materials::list_completions).post(materials::create_completion),
        )
        .route(
            "/api/materiales/{id}/contenido/",
            get(crate::material_text::extract),
        )
        .route(
            "/api/materiales-completados/{id}/",
            get(materials::completion_detail)
                .patch(materials::update_completion)
                .delete(materials::delete_completion),
        )
        .route(
            "/api/materiales-completados/delete-many/",
            post(materials::delete_completions_many),
        )
        .route(
            "/api/publicaciones-boe/",
            get(materials::list_publications).post(materials::create_publication),
        )
        .route(
            "/api/publicaciones-boe/{id}/",
            get(materials::publication_detail)
                .patch(materials::update_publication)
                .delete(materials::delete_publication),
        )
        .route(
            "/api/permisos-acceso-material/",
            get(materials::list_permissions).post(materials::create_permission),
        )
        .route(
            "/api/permisos-acceso-material/{id}/",
            get(materials::permission_detail)
                .patch(materials::update_permission)
                .delete(materials::delete_permission),
        )
        .route("/ws/chat/{room_id}/", get(chat::socket))
        .route(
            "/api/conexiones/",
            get(crate::connections::list_connections).post(crate::connections::create_connection),
        )
        .route(
            "/api/conexiones/{id}/",
            axum::routing::patch(crate::connections::update_connection)
                .delete(crate::connections::delete_connection),
        )
        .route(
            "/api/conexiones/delete-many/",
            post(crate::connections::delete_connections_many),
        )
        .route(
            "/api/registros-conexion/",
            get(crate::connections::list_access_logs),
        )
        .route(
            "/api/registros-conexion/activas/",
            get(crate::connections::active_sessions),
        )
        .route(
            "/api/registros-conexion/{id}/",
            get(crate::connections::access_log_detail)
                .patch(crate::connections::update_access_log)
                .delete(crate::connections::delete_access_log),
        )
        .route(
            "/api/registros-conexion/bulk/",
            axum::routing::patch(crate::connections::bulk_update_access_logs),
        )
        .route(
            "/api/registros-conexion/delete-many/",
            post(crate::connections::delete_access_logs_many),
        )
        .route(
            "/ws/conexiones/",
            get(crate::connections::connections_socket),
        )
        .route(
            "/api/mensajes/",
            get(crate::connections::list_messages).post(crate::connections::create_message),
        )
        .route(
            "/api/mensajes/{id}/",
            get(crate::connections::message_detail)
                .patch(crate::connections::update_message)
                .delete(crate::connections::delete_message),
        )
        .route(
            "/api/mensajes/summaries/",
            get(crate::connections::message_summaries),
        )
        .route(
            "/api/mensajes/unread/",
            get(crate::connections::message_unread),
        )
        .route(
            "/api/mensajes/broadcast/",
            post(crate::connections::direct_broadcast),
        )
        .route(
            "/api/mensajes/delete-many/",
            post(crate::connections::delete_messages_many),
        )
        .route(
            "/api/mensajes/mark-read/",
            post(crate::connections::mark_read),
        )
        .route(
            "/api/mensajes/clear-chat/",
            post(crate::connections::clear_chat),
        )
        .route(
            "/api/mensajes-staff/",
            get(crate::connections::list_staff).post(crate::connections::create_staff),
        )
        .route(
            "/api/mensajes-staff/{id}/",
            get(crate::connections::staff_detail),
        )
        .route(
            "/api/mensajes-staff/contacts/",
            get(crate::connections::contacts),
        )
        .route(
            "/api/mensajes-staff/summaries/",
            get(crate::connections::staff_summaries),
        )
        .route(
            "/api/mensajes-staff/unread/",
            get(crate::connections::staff_unread),
        )
        .route(
            "/api/mensajes-staff/mark-read/",
            post(crate::connections::staff_mark_read),
        )
        .route(
            "/api/mensajes-staff/clear-chat/",
            post(crate::connections::staff_clear),
        )
        .route(
            "/api/mensajes-staff/broadcast/",
            post(crate::connections::staff_broadcast),
        )
        .route(
            "/api/videollamadas/",
            get(crate::video::list).post(crate::video::create),
        )
        .route(
            "/api/videollamadas/{id}/",
            get(crate::video::detail)
                .patch(crate::video::update)
                .delete(crate::video::delete),
        )
        .route("/ws/videollamada/{id}/", get(crate::video::socket))
        .route("/api/videollamadas/ice/", get(crate::video::ice_config))
        .route(
            "/api/uploads/",
            post(crate::uploads::general).layer(DefaultBodyLimit::max(20 * 1024 * 1024)),
        )
        .route(
            "/api/uploads/avatar/",
            post(crate::uploads::avatar).layer(DefaultBodyLimit::max(5 * 1024 * 1024)),
        )
        .route(
            "/api/uploads/register-avatar/",
            post(crate::uploads::registration_avatar).layer(DefaultBodyLimit::max(5 * 1024 * 1024)),
        )
        .route("/api/media/{*path}", get(crate::uploads::download))
        .route("/api/backups/status/", get(crate::backups::status))
        .route("/api/backups/history/", get(crate::backups::history))
        .route("/api/backups/{id}/", delete(crate::backups::delete_backup))
        .route("/api/backups/create/", post(crate::backups::create))
        .route("/api/backups/verify/", post(crate::backups::verify))
        .route("/api/backups/origins/", get(crate::backups::origins))
        .route("/api/backups/retention/", post(crate::backups::retention))
        .route(
            "/api/backups/test-connection/",
            post(crate::backups::test_connection),
        )
        .route("/api/backups/restore/", post(crate::backups::restore))
        .route(
            "/api/backups/restore-status/",
            get(crate::backups::restore_status),
        )
        .route(
            "/api/backups/restore-test/",
            post(crate::backups::restore_test),
        )
        .route(
            "/api/backups/config/",
            get(crate::backups::get_config).put(crate::backups::put_config),
        )
        .route(
            "/api/backups/servers/",
            get(crate::backups::list_servers).post(crate::backups::create_server),
        )
        .route(
            "/api/backups/servers/{id}/",
            get(crate::backups::get_server)
                .put(crate::backups::update_server)
                .delete(crate::backups::delete_server),
        )
        .fallback(api::not_found)
        .layer(RequestBodyLimitLayer::new(100 * 1024 * 1024))
        .layer(PropagateRequestIdLayer::new(request_id.clone()))
        .layer(SetRequestIdLayer::new(request_id, MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
        .layer(CatchPanicLayer::new())
        .layer(middleware::from_fn(normalize_validation_status))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::validate_active_session,
        ))
        .layer(cors)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::system_status::validate_host,
        ))
        .layer(middleware::from_fn(security_headers))
        .layer(middleware::from_fn(
            crate::system_status::sanitize_proxy_headers,
        ))
        .with_state(state)
}

async fn normalize_validation_status(request: Request<axum::body::Body>, next: Next) -> Response {
    let response = next.run(request).await;
    if response.status() == StatusCode::UNPROCESSABLE_ENTITY {
        return AppError::Validation("Solicitud no válida. Compruebe los campos enviados.".into())
            .into_response();
    }
    response
}

async fn security_headers(request: Request<axum::body::Body>, next: Next) -> Response {
    let unsafe_method = !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
    );
    let cross_site = request
        .headers()
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("cross-site"));
    let origin_denied = request
        .headers()
        .get(axum::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|origin| {
            !std::env::var("CORS_ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:5173,http://127.0.0.1:5173".to_owned())
                .split(',')
                .any(|allowed| allowed.trim() == origin)
        });
    let mut response = if unsafe_method && (cross_site || origin_denied) {
        crate::error::AppError::Forbidden.into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers
        .entry(axum::http::header::CACHE_CONTROL)
        .or_insert(HeaderValue::from_static("no-store"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow"),
    );
    headers.insert(
        "referrer-policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    response
}

fn cors_layer() -> CorsLayer {
    let origins: Vec<HeaderValue> = std::env::var("CORS_ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:5173,http://127.0.0.1:5173".to_owned())
        .split(',')
        .filter_map(|origin| origin.trim().parse().ok())
        .collect();
    CorsLayer::new()
        .allow_origin(origins)
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::IF_MATCH,
            HeaderName::from_static("x-csrftoken"),
            HeaderName::from_static("x-client-meta"),
            HeaderName::from_static("x-uasspain-window-id"),
        ])
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn host_allowlist_rejects_missing_duplicate_and_conflicting_hosts() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;

        let app = super::build_router(std::sync::Arc::new(super::AppState::for_test()));
        let requests = [
            Request::builder().uri("/api/health/live/"),
            Request::builder()
                .uri("/api/health/live/")
                .header("host", "localhost")
                .header("host", "localhost"),
            Request::builder()
                .uri("http://localhost/api/health/live/")
                .header("host", "127.0.0.1"),
            Request::builder()
                .uri("/api/health/live/")
                .header("host", "random.example.com")
                .header("x-forwarded-host", "localhost"),
        ];
        for request in requests {
            let response = app
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            assert!(response.headers().contains_key("content-security-policy"));
        }
        let response = app
            .oneshot(
                Request::builder()
                    .version(axum::http::Version::HTTP_2)
                    .uri("https://localhost:8445/api/health/live/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
    }

    #[tokio::test]
    async fn empty_host_allowlist_fails_closed() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;

        let mut state = super::AppState::for_test();
        state.allowed_hosts.clear();
        let response = super::build_router(std::sync::Arc::new(state))
            .oneshot(
                Request::builder()
                    .uri("/api/health/live/")
                    .header("host", "localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn detailed_administration_endpoints_are_not_public() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        for path in [
            "/api/system/status/",
            "/api/system/smtp/",
            "/api/system/google-oauth/",
            "/api/backups/servers/",
        ] {
            let response = super::build_router(std::sync::Arc::new(super::AppState::for_test()))
                .oneshot(
                    Request::builder()
                        .header("host", "localhost")
                        .uri(path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
        }
    }
    use super::{AppState, build_router};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use std::sync::Arc;
    use tower::ServiceExt;

    #[tokio::test]
    async fn optional_session_is_anonymous_only_without_credentials() {
        for (path, authorization, cookie, expected) in [
            ("/api/auth/me/", None, None, StatusCode::UNAUTHORIZED),
            ("/api/auth/me/?optional=true", None, None, StatusCode::OK),
            (
                "/api/auth/me/?optional=true",
                Some("Bearer invalid"),
                None,
                StatusCode::UNAUTHORIZED,
            ),
            (
                "/api/auth/me/?optional=true",
                None,
                Some("uasspain_access=invalid"),
                StatusCode::UNAUTHORIZED,
            ),
            (
                "/api/auth/me/?optional=true",
                None,
                Some("uasspain_refresh=invalid"),
                StatusCode::UNAUTHORIZED,
            ),
        ] {
            let mut request = Request::builder().header("host", "localhost").uri(path);
            if let Some(value) = authorization {
                request = request.header("authorization", value);
            }
            if let Some(value) = cookie {
                request = request.header("cookie", value);
            }
            let response = build_router(Arc::new(AppState::for_test()))
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), expected, "{path}");
            if expected == StatusCode::OK {
                assert_eq!(response.headers()["cache-control"], "private, no-store");
                let body = response.into_body().collect().await.unwrap().to_bytes();
                assert_eq!(body.as_ref(), b"null");
            }
        }
    }

    #[tokio::test]
    async fn rejected_sessions_retain_security_and_allowed_origin_headers() {
        let response = build_router(Arc::new(AppState::for_test()))
            .oneshot(
                Request::builder()
                    .header("host", "localhost")
                    .uri("/api/auth/me/")
                    .header("authorization", "Bearer invalid")
                    .header("origin", "http://localhost:5173")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(
            response.headers()["content-security-policy"],
            "default-src 'none'; frame-ancestors 'none'"
        );
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            "http://localhost:5173"
        );
    }

    #[tokio::test]
    async fn liveness_contract_is_stable() {
        let response = build_router(Arc::new(AppState::for_test()))
            .oneshot(
                Request::builder()
                    .header("host", "localhost")
                    .uri("/api/health/live/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(response.headers()["x-frame-options"], "DENY");
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(std::str::from_utf8(&body).unwrap(), r#"{"status":"alive"}"#);
    }

    #[tokio::test]
    async fn unknown_routes_do_not_leak_internals() {
        let response = build_router(Arc::new(AppState::for_test()))
            .oneshot(
                Request::builder()
                    .header("host", "localhost")
                    .uri("/missing")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn cross_site_write_is_rejected() {
        let response = build_router(Arc::new(AppState::for_test()))
            .oneshot(
                Request::builder()
                    .header("host", "localhost")
                    .method("POST")
                    .uri("/api/auth/login/")
                    .header("origin", "https://attacker.invalid")
                    .header("sec-fetch-site", "cross-site")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn invalid_json_shape_uses_legacy_bad_request_contract() {
        let response = build_router(Arc::new(AppState::for_test()))
            .oneshot(
                Request::builder()
                    .header("host", "localhost")
                    .method("POST")
                    .uri("/api/auth/login/")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"email":[]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
