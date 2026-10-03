use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use uasspain_backend::{AppState, build_router, observability};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .map_err(|_| "failed to install the rustls crypto provider")?;
    if std::env::args().any(|arg| arg == "--healthcheck") {
        let address = std::env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:8000".to_owned());
        std::net::TcpStream::connect_timeout(&address.parse()?, std::time::Duration::from_secs(2))?;
        return Ok(());
    }
    dotenvy::dotenv().ok();
    observability::init();

    let state = Arc::new(AppState::from_env().await?);
    uasspain_backend::backups::spawn_scheduler(Arc::clone(&state));
    let app = build_router(state);
    let address: SocketAddr = std::env::var("BIND_ADDRESS")
        .unwrap_or_else(|_| "0.0.0.0:8000".to_owned())
        .parse()?;

    let cert = std::env::var_os("TLS_CERT_FILE").map(PathBuf::from);
    let key = std::env::var_os("TLS_KEY_FILE").map(PathBuf::from);
    match (cert, key) {
        (Some(cert), Some(key)) => {
            let tls = axum_server::tls_rustls::RustlsConfig::from_pem_file(cert, key).await?;
            tracing::info!(%address, transport = "https", "UASSpain Rust backend listening");
            let handle = axum_server::Handle::new();
            let shutdown_handle = handle.clone();
            tokio::spawn(async move {
                shutdown_signal().await;
                shutdown_handle.graceful_shutdown(Some(std::time::Duration::from_secs(10)));
            });
            axum_server::bind_rustls(address, tls)
                .handle(handle)
                .serve(app.into_make_service_with_connect_info::<SocketAddr>())
                .await?;
        }
        (None, None) => {
            tracing::warn!(%address, transport = "http", "TLS disabled; intended for local tests only");
            let listener = tokio::net::TcpListener::bind(address).await?;
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(shutdown_signal())
            .await?;
        }
        _ => return Err("TLS_CERT_FILE and TLS_KEY_FILE must be configured together".into()),
    }
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { () = ctrl_c => {}, () = terminate => {} }
}
