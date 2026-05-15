//! Embedded axum server wiring: TCP bind selection plus the background
//! task that hosts the desktop-specific routes alongside the shared
//! `aura_os_server` API surface.

use axum::routing::{get as axum_get, post as axum_post};
use axum::Router;
use std::net::TcpListener as StdTcpListener;
use std::path::PathBuf;
use std::sync::Arc;
use tao::event_loop::EventLoopProxy;
use tokio::net::TcpListener;
use tracing::{info, warn};

use crate::events::UserEvent;
use crate::handlers;
use crate::init::env::ci_mode_enabled;
use crate::route_state::RouteState;
use crate::updater::{self, UpdateState};

pub(crate) fn preferred_port() -> u16 {
    aura_os_core::Channel::current().preferred_desktop_port()
}

pub(crate) fn bind_listener() -> (StdTcpListener, u16, String) {
    let preferred = preferred_port();
    let configured_port = std::env::var("AURA_SERVER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0);

    let bind_fallback_listener = || {
        StdTcpListener::bind(format!("127.0.0.1:{preferred}"))
            .or_else(|_| StdTcpListener::bind("127.0.0.1:0"))
            .expect("failed to bind to an available port")
    };

    let std_listener = if let Some(port) = configured_port {
        match StdTcpListener::bind(format!("127.0.0.1:{port}")) {
            Ok(listener) => listener,
            Err(error) if ci_mode_enabled() => {
                panic!("failed to bind configured AURA_SERVER_PORT={port}: {error}")
            }
            Err(error) => {
                warn!(
                    %error,
                    configured_port = port,
                    fallback_port = preferred,
                    "configured AURA_SERVER_PORT unavailable; falling back to an available port"
                );
                bind_fallback_listener()
            }
        }
    } else {
        bind_fallback_listener()
    };
    std_listener
        .set_nonblocking(true)
        .expect("failed to set non-blocking");
    let port = std_listener
        .local_addr()
        .expect("listener must have local address")
        .port();
    let url = format!("http://127.0.0.1:{port}");
    info!(%url, "server binding ready");
    (std_listener, port, url)
}

/// Result of the embedded-server boot phase. `Ok(())` means the server
/// is bound and serving; `Err(message)` is a human-readable description
/// of why startup failed. The main thread surfaces this in a dialog
/// rather than panicking with an opaque `RecvError`, so a corrupt
/// settings store or other one-off failure no longer makes the desktop
/// shell exit silently with no UI.
pub(crate) type ServerReadyResult = Result<(), String>;

pub(crate) fn spawn_server(
    std_listener: StdTcpListener,
    store_path: PathBuf,
    interface_dir: Option<PathBuf>,
    ide_proxy: Arc<EventLoopProxy<UserEvent>>,
    route_state: RouteState,
) -> std::sync::mpsc::Receiver<ServerReadyResult> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<ServerReadyResult>();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
        rt.block_on(async move {
            let updater_data_dir = store_path
                .parent()
                .map(std::path::Path::to_path_buf)
                .unwrap_or_else(|| store_path.clone());
            let update_state = UpdateState::load(&updater_data_dir);
            {
                let shutdown_proxy = Arc::clone(&ide_proxy);
                update_state.set_shutdown_hook(move || {
                    if let Err(error) = shutdown_proxy.send_event(UserEvent::ShutdownForUpdate) {
                        warn!(%error, "failed to post ShutdownForUpdate event");
                    }
                });
            }
            let update_install_state = handlers::UpdateInstallRouteState {
                proxy: ide_proxy.clone(),
                update_state: update_state.clone(),
            };

            // Don't panic on a settings-store open failure: send the
            // error back over the ready channel so the main thread can
            // pop a real "AURA could not start" dialog instead of
            // exiting silently. The previous `.expect(...)` here is
            // exactly what made a corrupt `<data>/store/settings.json`
            // (e.g. all-NUL after a torn write) take the entire app
            // down with no UI on Windows release builds.
            let app_state = match aura_os_server::build_app_state(&store_path) {
                Ok(state) => state,
                Err(error) => {
                    let message = format!(
                        "failed to open local settings store at {}: {error}",
                        store_path.display()
                    );
                    tracing::error!(
                        error = %error,
                        store_path = %store_path.display(),
                        "embedded server startup failed: settings store could not be opened"
                    );
                    let _ = ready_tx.send(Err(message));
                    return;
                }
            };
            let desktop_routes = Router::new()
                .route("/api/pick-folder", axum_post(handlers::pick_folder))
                .route("/api/pick-file", axum_post(handlers::pick_file))
                .route(
                    "/api/last-route",
                    axum_post(handlers::post_last_route).with_state(route_state.clone()),
                )
                .route("/api/open-path", axum_post(handlers::open_path))
                .route("/api/write-file", axum_post(handlers::write_file))
                .route(
                    "/api/open-ide",
                    axum_post(handlers::open_ide).with_state(ide_proxy),
                )
                .route(
                    "/api/update-status",
                    axum_get(handlers::get_update_status).with_state(update_state.clone()),
                )
                .route(
                    "/api/runtime-config",
                    axum_get(handlers::get_runtime_config),
                )
                .route(
                    "/api/update-install",
                    axum_post(handlers::post_update_install).with_state(update_install_state),
                )
                .route(
                    "/api/update-check",
                    axum_post(handlers::post_update_check).with_state(update_state.clone()),
                )
                .route(
                    "/api/update-channel",
                    axum_post(handlers::post_update_channel).with_state(update_state.clone()),
                )
                .route(
                    "/api/update-reveal-logs",
                    axum_post(handlers::post_update_reveal_logs).with_state(update_state.clone()),
                )
                .route(
                    "/api/update-stage-only",
                    axum_post(handlers::post_update_stage_only).with_state(update_state.clone()),
                )
                .route(
                    "/api/update-bundle-info",
                    axum_get(handlers::get_update_bundle_info),
                )
                .route(
                    "/api/update-relocate-and-relaunch",
                    axum_post(handlers::post_update_relocate_and_relaunch)
                        .with_state(update_state.clone()),
                )
                .layer(aura_os_server::build_local_api_cors_layer());

            let app = aura_os_server::create_router_with_interface(app_state, interface_dir)
                .merge(desktop_routes);

            updater::spawn_update_loop(update_state);

            let listener = match TcpListener::from_std(std_listener) {
                Ok(listener) => listener,
                Err(error) => {
                    let message = format!("failed to convert std listener to tokio: {error}");
                    tracing::error!(%error, "{message}");
                    let _ = ready_tx.send(Err(message));
                    return;
                }
            };

            let _ = ready_tx.send(Ok(()));
            axum::serve(listener, app).await.expect("server error");
        });
    });

    ready_rx
}
