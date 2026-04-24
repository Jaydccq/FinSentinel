/// Health-check command used by the desktop runtime smoke tests to verify
/// that the Tauri IPC boundary is wired correctly. A successful
/// `invoke('ping')` round-trip means the webview loaded, the Rust core
/// started, and the invoke_handler dispatch table accepts commands.
///
/// See [docs/exec-plans/2026-04-24-f9-desktop-ping-smoke.md](../../../../docs/exec-plans/2026-04-24-f9-desktop-ping-smoke.md).
#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_pong() {
        assert_eq!(ping(), "pong");
    }

    /// F-9 runtime smoke — drives `invoke('ping')` through a mock Tauri
    /// runtime to prove the IPC dispatch table is wired correctly.
    ///
    /// Unlike `ping_returns_pong` (which calls the function directly),
    /// this exercises the full InvokeRequest → InvokeResponse serde
    /// round-trip under `tauri::test::MockRuntime`. It runs under plain
    /// `cargo test` — no xvfb or real webview needed — so the assertion
    /// can live in the PR-time smoke workflow. See
    /// `docs/exec-plans/2026-04-24-f9-desktop-ping-smoke.md` for the
    /// parked full-display smoke follow-up.
    ///
    /// Lives in the same module as `ping` so the `#[tauri::command]`-
    /// generated `__cmd__ping` macro is in direct textual scope —
    /// Rust's macro_export hygiene forbids referring to it via
    /// `crate::__cmd__ping` absolute paths.
    #[test]
    fn ping_round_trips_through_ipc() {
        use tauri::test::{
            get_ipc_response, mock_builder, mock_context, noop_assets,
            INVOKE_KEY,
        };

        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![super::ping])
            .build(mock_context(noop_assets()))
            .expect("failed to build mock Tauri app");

        let webview = tauri::WebviewWindowBuilder::new(
            &app,
            "main",
            Default::default(),
        )
        .build()
        .expect("webview build");

        let res = get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "ping".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().expect("url parse"),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .expect("ping dispatch")
        .deserialize::<String>()
        .expect("deserialize pong");

        assert_eq!(res, "pong");
    }
}

