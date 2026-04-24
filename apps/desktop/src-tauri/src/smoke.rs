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
}
