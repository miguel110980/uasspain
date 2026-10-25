use super::*;
use crate::mail_provider::Envelope;
use axum::{Form, http::StatusCode};

async fn setting(state: &AppState, key: &str, value: Value) {
    let mut tx = state.pool.as_ref().unwrap().begin().await.unwrap();
    crate::mail_config::put_setting(&mut tx, key, value)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}
fn admin_headers(actor: Uuid) -> HeaderMap {
    let now = Utc::now().timestamp() as usize;
    let claims = crate::auth::Claims {
        user_id: 0,
        profile_id: actor,
        role: "admin".into(),
        token_type: "access".into(),
        iat: now,
        exp: now + 3600,
        jti: Uuid::new_v4(),
        session_key: String::new(),
    };
    let jwt = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(
            b"test-only-not-for-production-test-only-not-for-production",
        ),
    )
    .unwrap();
    let mut h = HeaderMap::new();
    h.insert("x-uasspain-verified-session", jwt.parse().unwrap());
    h
}
async fn envelope(state: &AppState, kind: &str) -> Envelope {
    let text:String=sqlx::query_scalar("SELECT payload_ciphertext FROM mail_outbox WHERE message_type=$1 ORDER BY created_at DESC LIMIT 1").bind(kind).fetch_one(state.pool.as_ref().unwrap()).await.unwrap();
    serde_json::from_str(&state.cipher.decrypt(&text).unwrap()).unwrap()
}
fn otp(e: &Envelope) -> String {
    e.body
        .split_whitespace()
        .find(|v| v.len() == 6 && v.bytes().all(|b| b.is_ascii_digit()))
        .unwrap()
        .into()
}
async fn control(client: &reqwest::Client, value: Value) {
    assert!(
        client
            .post("http://mail-dual-fixture:2527/control")
            .json(&value)
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );
}
async fn test_service(
    state: Arc<AppState>,
    h: HeaderMap,
    service: Service,
) -> Result<Json<Value>, AppError> {
    let v = view(&state, service).await?;
    test(
        State(state),
        h,
        Path(service.key().into()),
        Json(Test {
            request_id: Some(Uuid::new_v4()),
            recipient: "probe@example.invalid".into(),
            revision: v["revision"].as_str().unwrap().into(),
            confirm_authorized_recipient: true,
        }),
    )
    .await
}
async fn save_service(
    state: Arc<AppState>,
    h: HeaderMap,
    service: Service,
    settings: Settings,
    password: String,
) -> Value {
    put(
        State(state),
        h,
        Path(service.key().into()),
        Json(Write { settings, password }),
    )
    .await
    .unwrap()
    .0
}

#[tokio::test]
#[ignore = "requires a dedicated internally networked SMTP fixture and marked disposable database; never operational credentials"]
async fn dual_smtp_services_isolated_integration() {
    macro_rules! gate {
        ($ok:expr,$label:literal) => {
            assert!($ok, $label);
            println!("PASS {}", $label);
        };
    }
    let url = std::env::var("MAIL_DUAL_TEST_DATABASE_URL").unwrap();
    assert!(url.contains("@mail-dual-db:") && url.ends_with("/test_e2e_uasspain"));
    assert!(runtime_config::env_true("APP_PRODUCTION"));
    assert!(!runtime_config::env_true("DEV_EMAIL"));
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect(&url)
        .await
        .unwrap();
    let marker: Option<String> =
        sqlx::query_scalar("SELECT current_setting('uasspain.mail_fixture',true)")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(marker.as_deref(), Some("mail-repair-20261025"));
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let mut state = AppState::for_test();
    state.pool = Some(pool.clone());
    let state = Arc::new(state);
    let actor = Uuid::new_v4();
    sqlx::query("INSERT INTO accounts_userprofile(id,created_date,updated_date,nombre,apellidos,email,username,dni_nie,foto_perfil,status,role,otp_hash,otp_verified,roles,username_lookup,email_lookup,dni_lookup,fecha_nacimiento,session_role) VALUES($1,NOW(),NOW(),'SMTP','Fixture','admin@example.invalid','admin','','','activo','admin','',true,'[\"admin\"]','dual-admin-name','dual-admin-email','','','admin')").bind(actor).execute(&pool).await.unwrap();
    let h = admin_headers(actor);
    let password = std::env::var("SMTP_DUAL_SHARED_PASSWORD").unwrap();
    let independent_password = std::env::var("SMTP_DUAL_AUTOMATIC_PASSWORD").unwrap();
    let config = SmtpConfig {
        enabled: true,
        host: "mail-dual-fixture".into(),
        port: 2525,
        security: "STARTTLS".into(),
        username: "shared-fixture".into(),
        from_email: "info@uasspain.com".into(),
        from_name: "UASSpain".into(),
        contact_recipient: "info@uasspain.com".into(),
        timeout_seconds: 2,
        ..Default::default()
    };
    let _ = crate::runtime_config::smtp_put(
        State(state.clone()),
        h.clone(),
        Json(runtime_config::SmtpWrite {
            config: config.clone(),
            password: password.clone(),
        }),
    )
    .await
    .unwrap();
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM mail_outbox")
        .fetch_one(&pool)
        .await
        .unwrap();
    let _ = validate(
        State(state.clone()),
        h.clone(),
        Path("automatic".into()),
        Json(Write {
            settings: Settings {
                enabled: true,
                authorized_sender: true,
                ..Default::default()
            },
            password: String::new(),
        }),
    )
    .await
    .unwrap();
    gate!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM mail_outbox")
            .fetch_one(&pool)
            .await
            .unwrap()
            == before,
        "validate_no_connection_queue_or_send"
    );
    gate!(
        matches!(
            get(
                State(state.clone()),
                HeaderMap::new(),
                Path("contact".into())
            )
            .await,
            Err(AppError::Unauthorized)
        ),
        "administration_denies_anonymous"
    );
    for service in [Service::Contact, Service::Automatic] {
        save_service(
            state.clone(),
            h.clone(),
            service,
            Settings {
                enabled: true,
                authorized_sender: true,
                ..Default::default()
            },
            String::new(),
        )
        .await;
    }
    gate!(
        !view(&state, Service::Automatic).await.unwrap()["active_ready"]
            .as_bool()
            .unwrap(),
        "shared_credentials_do_not_prove_automatic_sender"
    );
    gate!(
        test(
            State(state.clone()),
            h.clone(),
            Path("contact".into()),
            Json(Test {
                recipient: "probe@example.invalid".into(),
                revision: String::new(),
                confirm_authorized_recipient: false,
                request_id: None,
            })
        )
        .await
        .is_err(),
        "no_consent_no_delivery"
    );
    let _ = test_service(state.clone(), h.clone(), Service::Contact)
        .await
        .unwrap();
    gate!(
        view(&state, Service::Contact).await.unwrap()["active_ready"] == true,
        "contact_sender_accepted_over_real_starttls"
    );
    gate!(
        test_service(state.clone(), h.clone(), Service::Automatic)
            .await
            .is_err(),
        "provider_rejects_unapproved_automatic_sender"
    );
    let email = format!("synthetic-{}@example.invalid", Uuid::new_v4());
    let user_password = format!("Aa9!{}", Uuid::new_v4().simple());
    let registration = || {
        serde_json::from_value(json!({"email":email,"password":user_password,"nombre":"Synthetic","apellidos":"SMTP","username":format!("u-{}",actor),"dni_nie":format!("FIX-{actor}"),"fecha_nacimiento":"2000-01-01"})).unwrap()
    };
    let users_before: i64 = sqlx::query_scalar("SELECT count(*) FROM auth_user")
        .fetch_one(&pool)
        .await
        .unwrap();
    gate!(
        crate::registration::register(State(state.clone()), HeaderMap::new(), Json(registration()))
            .await
            .is_err(),
        "registration_never_falls_back_to_contact_identity"
    );
    gate!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM auth_user")
            .fetch_one(&pool)
            .await
            .unwrap()
            == users_before,
        "blocked_otp_rolls_back_registration"
    );
    let client = reqwest::Client::new();
    control(&client, json!({"allow_auto":true,"mode":"accept"})).await;
    let _ = test_service(state.clone(), h.clone(), Service::Automatic)
        .await
        .unwrap();
    gate!(
        view(&state, Service::Automatic).await.unwrap()["active_ready"] == true,
        "automatic_sender_requires_its_own_real_acceptance"
    );
    let shared_candidate = SmtpConfig {
        timeout_seconds: 3,
        ..config.clone()
    };
    let candidate = crate::runtime_config::smtp_put(
        State(state.clone()),
        h.clone(),
        Json(runtime_config::SmtpWrite {
            config: shared_candidate.clone(),
            password: String::new(),
        }),
    )
    .await
    .unwrap()
    .0;
    gate!(
        candidate["pending_verification"] == true,
        "shared_transport_change_staged_for_existing_services"
    );
    let _ = test_service(state.clone(), h.clone(), Service::Contact)
        .await
        .unwrap();
    gate!(
        crate::runtime_config::smtp_put(
            State(state.clone()),
            h.clone(),
            Json(runtime_config::SmtpWrite {
                config: shared_candidate.clone(),
                password: String::new()
            })
        )
        .await
        .is_err(),
        "contact_test_cannot_authorize_automatic_shared_cutover"
    );
    gate!(
        runtime_config::smtp(&state)
            .await
            .unwrap()
            .0
            .timeout_seconds
            == 2
            && view(&state, Service::Automatic).await.unwrap()["active_ready"] == true,
        "unverified_shared_change_preserves_automatic_transport"
    );
    let _ = test_service(state.clone(), h.clone(), Service::Automatic)
        .await
        .unwrap();
    let _ = crate::runtime_config::smtp_put(
        State(state.clone()),
        h.clone(),
        Json(runtime_config::SmtpWrite {
            config: shared_candidate,
            password: String::new(),
        }),
    )
    .await
    .unwrap();
    gate!(
        view(&state, Service::Automatic).await.unwrap()["active_ready"] == true
            && view(&state, Service::Contact).await.unwrap()["active_ready"] == true,
        "shared_cutover_requires_both_sender_acceptances"
    );
    let mut constrained = AppState::for_test();
    constrained.pool = Some(
        sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .unwrap(),
    );
    let constrained = Arc::new(constrained);
    let race = async {
        let mut tasks = Vec::new();
        for _ in 0..4 {
            let state = constrained.clone();
            tasks.push(tokio::spawn(async move {
                let mut tx = state.pool.as_ref().unwrap().begin().await?;
                let id = crate::mail_queue::enqueue(
                    &state,
                    &mut tx,
                    crate::mail_queue::MailRequest {
                        to: "race@example.invalid",
                        reply_to: None,
                        subject: "Synthetic race",
                        body: "No delivery",
                        options: crate::mail_queue::QueueOptions {
                            kind: "notification",
                            ttl: chrono::Duration::minutes(1),
                            validity: json!({}),
                            idempotency: None,
                        },
                    },
                )
                .await?;
                tx.rollback().await?;
                Ok::<_, AppError>(id)
            }));
        }
        for task in tasks {
            task.await.unwrap().unwrap();
        }
    };
    gate!(
        tokio::time::timeout(std::time::Duration::from_secs(10), race)
            .await
            .is_ok(),
        "concurrent_mail_transactions_do_not_exhaust_small_connection_pool"
    );
    let mut visitor = HeaderMap::new();
    visitor.insert("origin", "https://localhost".parse().unwrap());
    visitor.insert(
        "x-uasspain-window-id",
        Uuid::new_v4().to_string().parse().unwrap(),
    );
    let contact_input = json!({"nombre":"Synthetic Visitor","empresa":"Fixture","email":"visitor@example.invalid","telefono":"","servicio":"Otro","asunto":"Synthetic contact","mensaje":"Synthetic enquiry with no external delivery.","website":"","request_id":Uuid::new_v4(),"from_email":"evil@example.invalid","recipient":"evil@example.invalid"});
    let contact = crate::contact::send(
        State(state.clone()),
        visitor.clone(),
        Json(serde_json::from_value(contact_input.clone()).unwrap()),
    )
    .await
    .unwrap();
    gate!(
        contact.0 == StatusCode::OK && contact.1.0["smtp_accepted"] == true,
        "contact_uses_live_local_smtp"
    );
    let received = envelope(&state, "contact").await;
    gate!(
        received.from == "info@uasspain.com"
            && received.to == "info@uasspain.com"
            && received.reply_to.as_deref() == Some("visitor@example.invalid"),
        "visitor_cannot_override_corporate_sender_or_destination"
    );
    // Simulate a corporate mail client's Reply action, never an application auto-response.
    let reply = Envelope {
        from: received.to.clone(),
        from_name: "UASSpain".into(),
        to: received.reply_to.clone().unwrap(),
        reply_to: None,
        subject: format!("Re: {}", received.subject),
        body: "Synthetic corporate client reply; isolated receiver only.".into(),
        smtp: None,
    };
    gate!(
        matches!(
            crate::mail_provider::smtp(&reply, &config, &password).await,
            crate::mail_provider::Outcome::Accepted(_)
        ),
        "isolated_corporate_client_reply_accepted_over_starttls"
    );
    let replies: Value = client
        .get("http://mail-dual-fixture:2527/messages")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let reply_received = replies.as_array().unwrap().last().unwrap();
    gate!(
        reply_received["sender"] == "info@uasspain.com"
            && reply_received["to"] == json!(["visitor@example.invalid"])
            && reply_received["tls"] == true,
        "isolated_reply_targets_visitor_from_corporate_identity"
    );
    let repeated = crate::contact::send(
        State(state.clone()),
        visitor.clone(),
        Json(serde_json::from_value(contact_input).unwrap()),
    )
    .await
    .unwrap();
    gate!(
        repeated.1.0["message_id"] == contact.1.0["message_id"],
        "contact_idempotency_preserved"
    );
    let created =
        crate::registration::register(State(state.clone()), HeaderMap::new(), Json(registration()))
            .await
            .unwrap();
    let id: Uuid = serde_json::from_value(created.1.0["id"].clone()).unwrap();
    let user_id = created.1.0["user_id"].as_i64().unwrap();
    let registration_mail = envelope(&state, "registration_otp").await;
    gate!(
        registration_mail.from == "no-reply@uasspain.com"
            && registration_mail.reply_to.is_none()
            && registration_mail.to == email,
        "registration_otp_uses_only_automatic_sender"
    );
    gate!(
        registration_mail
            .body
            .contains(crate::mail_provider::AUTOMATED_NOTICE)
            && crate::mail_provider::AUTOMATED_NOTICE.contains("no respondas")
            && crate::mail_provider::AUTOMATED_NOTICE.contains("info@uasspain.com"),
        "automatic_message_explains_no_reply_and_corporate_contact"
    );
    let code = otp(&registration_mail);
    let verification = || serde_json::from_value(json!({"email":email,"code":code})).unwrap();
    gate!(
        crate::registration::verify_otp(
            State(state.clone()),
            HeaderMap::new(),
            Json(verification())
        )
        .await
        .is_ok(),
        "registration_otp_consumed_once"
    );
    gate!(
        crate::registration::verify_otp(
            State(state.clone()),
            HeaderMap::new(),
            Json(verification())
        )
        .await
        .is_err(),
        "registration_otp_replay_denied"
    );
    sqlx::query("UPDATE accounts_userprofile SET status='activo' WHERE id=$1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let _ = crate::api::auth_policy_put(
        State(state.clone()),
        h.clone(),
        Json(serde_json::from_value(json!({"enabled":true,"required_roles":["alumno"]})).unwrap()),
    )
    .await
    .unwrap();
    let login = |code: Option<String>| {
        Json(crate::auth::LoginRequest {
            email: email.clone(),
            password: user_password.clone(),
            code,
            session_role: None,
        })
    };
    let requested = crate::auth::login(State(state.clone()), visitor.clone(), login(None))
        .await
        .unwrap();
    gate!(
        requested.status() == StatusCode::ACCEPTED,
        "2fa_issues_automatic_otp"
    );
    let login_mail = envelope(&state, "login_otp").await;
    let login_code = otp(&login_mail);
    gate!(
        login_mail.from == "no-reply@uasspain.com" && login_mail.reply_to.is_none(),
        "2fa_has_no_visitor_reply_to"
    );
    let wrong = if login_code == "111111" {
        "222222"
    } else {
        "111111"
    };
    gate!(
        crate::auth::login(
            State(state.clone()),
            visitor.clone(),
            login(Some(wrong.into()))
        )
        .await
        .is_err(),
        "2fa_wrong_code_denied"
    );
    sqlx::query("UPDATE accounts_userprofile SET login_otp_created_at=NOW()-INTERVAL '16 minutes' WHERE id=$1").bind(id).execute(&pool).await.unwrap();
    gate!(
        crate::auth::login(
            State(state.clone()),
            visitor.clone(),
            login(Some(login_code))
        )
        .await
        .is_err(),
        "2fa_expired_code_denied"
    );
    gate!(
        crate::auth::login(State(state.clone()), visitor.clone(), login(None))
            .await
            .unwrap()
            .status()
            == StatusCode::ACCEPTED,
        "2fa_reissue_uses_automatic_sender"
    );
    let current_code = otp(&envelope(&state, "login_otp").await);
    gate!(
        crate::auth::login(
            State(state.clone()),
            visitor.clone(),
            login(Some(current_code.clone()))
        )
        .await
        .unwrap()
        .status()
            == StatusCode::OK,
        "2fa_authentication_succeeds_after_valid_code"
    );
    gate!(
        crate::auth::login(
            State(state.clone()),
            visitor.clone(),
            login(Some(current_code))
        )
        .await
        .is_err(),
        "2fa_code_replay_denied"
    );
    let recovery = crate::registration::password_reset_request(
        State(state.clone()),
        HeaderMap::new(),
        Json(serde_json::from_value(json!({"email":email})).unwrap()),
    )
    .await
    .unwrap();
    let absent = crate::registration::password_reset_request(
        State(state.clone()),
        HeaderMap::new(),
        Json(serde_json::from_value(json!({"email":"absent@example.invalid"})).unwrap()),
    )
    .await
    .unwrap();
    gate!(
        recovery.0 == absent.0,
        "recovery_response_does_not_enumerate_accounts"
    );
    for _ in 0..60 {
        let n:i64=sqlx::query_scalar("SELECT count(*) FROM mail_outbox WHERE message_type='password_reset' AND state='ACCEPTED'").fetch_one(&pool).await.unwrap();
        if n > 0 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let reset_mail = envelope(&state, "password_reset").await;
    gate!(
        reset_mail.from == "no-reply@uasspain.com" && reset_mail.reply_to.is_none(),
        "recovery_uses_automatic_sender"
    );
    let link = reqwest::Url::parse(
        reset_mail
            .body
            .split_whitespace()
            .find(|s| s.starts_with("https://"))
            .unwrap(),
    )
    .unwrap();
    let params: std::collections::HashMap<String, String> =
        link.query_pairs().into_owned().collect();
    let new_password = format!("Bb8!{}", Uuid::new_v4().simple());
    let reset = || {
        Form(
            serde_json::from_value(
                json!({"uid":params["uid"],"token":params["token"],"password":new_password}),
            )
            .unwrap(),
        )
    };
    gate!(
        crate::registration::password_reset_confirm(
            State(state.clone()),
            HeaderMap::new(),
            reset()
        )
        .await
        .is_ok(),
        "recovery_token_consumed"
    );
    gate!(
        crate::registration::password_reset_confirm(
            State(state.clone()),
            HeaderMap::new(),
            reset()
        )
        .await
        .is_err(),
        "recovery_token_replay_denied"
    );
    gate!(sqlx::query_scalar::<_,bool>("SELECT NOT EXISTS(SELECT 1 FROM accounts_passwordresettoken WHERE user_id=$1 AND consumed_at IS NULL)").bind(user_id as i32).fetch_one(&pool).await.unwrap(),"password_reset_invalidates_live_tokens");
    crate::email::send(
        &state,
        "notification@example.invalid",
        "Synthetic notification",
        "Local fixture only.",
    )
    .await
    .unwrap();
    gate!(
        envelope(&state, "notification").await.from == "no-reply@uasspain.com",
        "notifications_use_automatic_sender"
    );
    let independent = Settings {
        enabled: true,
        shared_transport: false,
        authorized_sender: true,
        independent_auth_required: true,
        config: Some(SmtpConfig {
            port: 2526,
            username: "automatic-fixture".into(),
            from_email: "no-reply@uasspain.com".into(),
            ..config.clone()
        }),
    };
    let draft = save_service(
        state.clone(),
        h.clone(),
        Service::Automatic,
        independent.clone(),
        independent_password.clone(),
    )
    .await;
    gate!(
        draft["pending_verification"] == true
            && active(&state, Service::Automatic).await.unwrap().0.username == "shared-fixture",
        "independent_credentials_staged_without_replacing_2fa_transport"
    );
    let _ = test_service(state.clone(), h.clone(), Service::Automatic)
        .await
        .unwrap();
    save_service(
        state.clone(),
        h.clone(),
        Service::Automatic,
        independent.clone(),
        String::new(),
    )
    .await;
    let encrypted: String = sqlx::query_scalar(
        "SELECT ciphertext FROM core_systemsecret WHERE key='smtp_automatic_password'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    gate!(
        state.cipher.decrypt(&encrypted).unwrap() == independent_password,
        "independent_password_encrypted_at_rest"
    );
    save_service(
        state.clone(),
        h.clone(),
        Service::Automatic,
        independent,
        String::new(),
    )
    .await;
    gate!(
        sqlx::query_scalar::<_, String>(
            "SELECT ciphertext FROM core_systemsecret WHERE key='smtp_automatic_password'"
        )
        .fetch_one(&pool)
        .await
        .unwrap()
            == encrypted,
        "blank_independent_password_preserves_exact_ciphertext"
    );
    control(&client, json!({"allow_auto":true,"mode":"authfail_auto"})).await;
    for _ in 0..3 {
        gate!(
            test_service(state.clone(), h.clone(), Service::Automatic)
                .await
                .is_err(),
            "independent_authentication_failure_reported"
        );
    }
    gate!(
        view(&state, Service::Contact).await.unwrap()["active_ready"] == true,
        "independent_failure_does_not_open_contact_circuit"
    );
    gate!(
        sqlx::query_scalar::<_, String>(
            "SELECT state FROM mail_circuit WHERE provider='smtp_automatic'"
        )
        .fetch_one(&pool)
        .await
        .unwrap()
            == "OPEN",
        "independent_circuit_is_durable"
    );
    control(&client, json!({"allow_auto":true,"mode":"accept"})).await;
    let _ = test_service(state.clone(), h.clone(), Service::Automatic)
        .await
        .unwrap();
    control(&client, json!({"allow_auto":true,"mode":"drop_auto"})).await;
    gate!(
        test_service(state.clone(), h.clone(), Service::Automatic)
            .await
            .is_err(),
        "smtp_disconnect_after_data_is_not_false_success"
    );
    gate!(
        view(&state, Service::Automatic).await.unwrap()["verification_status"] == "UNKNOWN",
        "uncertain_result_is_visible_per_service"
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM mail_outbox")
        .fetch_one(&pool)
        .await
        .unwrap();
    gate!(
        test_service(state.clone(), h.clone(), Service::Automatic)
            .await
            .is_err()
            && sqlx::query_scalar::<_, i64>("SELECT count(*) FROM mail_outbox")
                .fetch_one(&pool)
                .await
                .unwrap()
                == count,
        "uncertain_service_test_cannot_be_resent"
    );
    // Full HTTP middleware and route contracts, on loopback inside the isolated
    // test container. This is not an application deployment or a published port.
    sqlx::query("UPDATE accounts_userprofile SET role='admin',roles='[\"admin\"]',session_role='admin' WHERE id=$1").bind(id).execute(&pool).await.unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let router = crate::app::build_router(state.clone());
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap()
    });
    let window = Uuid::new_v4().to_string();
    let login_response = client
        .post(format!("{origin}/api/auth/login/"))
        .header("Host", "localhost")
        .header("Origin", "https://localhost")
        .header("X-UASSpain-Window-Id", &window)
        .json(&json!({"email":email,"password":new_password}))
        .send()
        .await
        .unwrap();
    gate!(
        login_response.status().is_success(),
        "real_http_administrator_login"
    );
    let cookie = login_response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap())
        .collect::<Vec<_>>()
        .join("; ");
    let endpoint = format!("{origin}/api/system/smtp/services/automatic/");
    let anonymous = client
        .get(&endpoint)
        .header("Host", "localhost")
        .send()
        .await
        .unwrap();
    gate!(
        anonymous.status() == reqwest::StatusCode::UNAUTHORIZED,
        "real_http_service_requires_session"
    );
    let forged = client
        .get(&endpoint)
        .header("Host", "localhost")
        .header(
            "x-uasspain-verified-session",
            h["x-uasspain-verified-session"].to_str().unwrap(),
        )
        .send()
        .await
        .unwrap();
    gate!(
        forged.status() == reqwest::StatusCode::UNAUTHORIZED,
        "http_client_cannot_forge_verified_admin_header"
    );
    let response = client
        .get(&endpoint)
        .header("Host", "localhost")
        .header("Cookie", &cookie)
        .header("X-UASSpain-Window-Id", &window)
        .send()
        .await
        .unwrap();
    gate!(
        response.status().is_success(),
        "real_http_service_configuration_contract"
    );
    let body: Value = response.json().await.unwrap();
    gate!(
        body["address"] == "no-reply@uasspain.com"
            && !body.to_string().contains(&password)
            && !body.to_string().contains(&independent_password),
        "http_configuration_never_returns_smtp_passwords"
    );
    server.abort();
    control(&client, json!({"allow_auto":true,"mode":"timeout_auto"})).await;
    let probe_view = view(&state, Service::Contact).await.unwrap();
    let probe = Test {
        recipient: "duplicate@example.invalid".into(),
        revision: probe_view["revision"].as_str().unwrap().into(),
        request_id: Some(Uuid::new_v4()),
        confirm_authorized_recipient: true,
    };
    let before_probe: i64 = sqlx::query_scalar("SELECT count(*) FROM mail_outbox")
        .fetch_one(&pool)
        .await
        .unwrap();
    let probe_admin = admin_headers(id);
    let (a, b) = tokio::join!(
        test(
            State(state.clone()),
            probe_admin.clone(),
            Path("contact".into()),
            Json(probe.clone())
        ),
        test(
            State(state.clone()),
            probe_admin.clone(),
            Path("contact".into()),
            Json(probe.clone())
        )
    );
    gate!(
        (a.is_ok() || b.is_ok())
            && sqlx::query_scalar::<_, i64>("SELECT count(*) FROM mail_outbox")
                .fetch_one(&pool)
                .await
                .unwrap()
                == before_probe + 1,
        "concurrent_test_requests_create_one_message"
    );
    let _ = test(
        State(state.clone()),
        probe_admin,
        Path("contact".into()),
        Json(probe),
    )
    .await
    .unwrap();
    gate!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM mail_outbox")
            .fetch_one(&pool)
            .await
            .unwrap()
            == before_probe + 1,
        "accepted_test_replay_does_not_send_again"
    );
    let recorded_at:DateTime<Utc>=sqlx::query_scalar("SELECT updated_at FROM mail_outbox WHERE message_type='provider_test' AND validity->>'smtp_service'='contact' AND validity->>'smtp_test_recipient'=$1 ORDER BY created_at DESC LIMIT 1").bind(state.cipher.blind_index("duplicate@example.invalid").unwrap()).fetch_one(&pool).await.unwrap();
    gate!(
        record(&state, Service::Contact)
            .await
            .unwrap()
            .proofs
            .iter()
            .any(
                |p| p.fingerprint == probe_view["revision"].as_str().unwrap()
                    && p.at == recorded_at
            ),
        "test_replay_does_not_refresh_provider_evidence_timestamp"
    );
    let mut timeout_settings = record(&state, Service::Automatic).await.unwrap().active;
    timeout_settings.config.as_mut().unwrap().timeout_seconds = 1;
    let timeout_admin = admin_headers(id);
    save_service(
        state.clone(),
        timeout_admin.clone(),
        Service::Automatic,
        timeout_settings,
        String::new(),
    )
    .await;
    let started = std::time::Instant::now();
    gate!(
        test_service(state.clone(), timeout_admin.clone(), Service::Automatic)
            .await
            .is_err()
            && started.elapsed() < std::time::Duration::from_secs(4),
        "smtp_timeout_is_bounded_and_not_false_success"
    );
    gate!(
        view(&state, Service::Automatic).await.unwrap()["verification_status"] == "UNKNOWN",
        "timeout_is_preserved_as_unknown"
    );

    let cipher_before: String =
        sqlx::query_scalar("SELECT ciphertext FROM core_systemsecret WHERE key='smtp_password'")
            .fetch_one(&pool)
            .await
            .unwrap();
    setting(
        &state,
        "mail_api",
        json!({"provider":"postmark","preserve":true}),
    )
    .await;
    setting(&state, "mail_mode", json!({"api_exclusive":true})).await;
    gate!(
        test_service(state.clone(), h.clone(), Service::Automatic)
            .await
            .is_err(),
        "saved_api_mode_blocks_smtp_without_switching"
    );
    gate!(
        view(&state, Service::Automatic).await.unwrap()["api_mode_blocked"] == true,
        "api_mode_block_visible_to_administration"
    );
    gate!(
        runtime_config::setting(&state, "mail_mode")
            .await
            .unwrap()
            .unwrap()["api_exclusive"]
            == true
            && sqlx::query_scalar::<_, String>(
                "SELECT ciphertext FROM core_systemsecret WHERE key='smtp_password'"
            )
            .fetch_one(&pool)
            .await
            .unwrap()
                == cipher_before,
        "api_configuration_and_shared_secret_preserved"
    );
    gate!(
        crate::mail_migration::monitor(State(state.clone()), h.clone())
            .await
            .unwrap()
            .0["channel"]
            == "BLOCKED_API_MODE",
        "monitor_and_administration_agree_on_api_block"
    );
    let messages: Value = client
        .get("http://mail-dual-fixture:2527/messages")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    gate!(
        messages
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["tls"] == true),
        "every_fixture_message_used_tls"
    );
    gate!(
        messages
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["sender"] == "no-reply@uasspain.com")
            .all(|m| m["reply_to"].is_null()),
        "no_automatic_message_contains_visitor_reply_to"
    );
    println!("DUAL_SMTP_ISOLATED=PASS; EXTERNAL_DELIVERY=NOT_RUN; OPERATIONAL_WRITES=0");
}
