use keyring::{Entry, Error as KeyringError};
use serde::Serialize;

// Service/user pair used across all platforms. Must stay stable so F-3's
// migration shim can clear the same slot it wrote to.
const SERVICE: &str = "finsentinel-desktop";
const USER: &str = "jwt";

#[derive(Debug, Serialize)]
pub struct AuthCommandError {
    /// Sentinels the web layer branches on: `not_found`, `session_only`, `io`.
    pub error: &'static str,
}

impl AuthCommandError {
    fn not_found() -> Self { Self { error: "not_found" } }
    fn session_only() -> Self { Self { error: "session_only" } }
    fn io() -> Self { Self { error: "io" } }
}

fn classify(err: KeyringError) -> AuthCommandError {
    match err {
        KeyringError::NoEntry => AuthCommandError::not_found(),
        // On Linux without Secret Service, or in sandboxes that block keychain
        // access, fall back to session-only mode (in-memory token on the JS
        // side, no durable storage).
        KeyringError::PlatformFailure(_) | KeyringError::NoStorageAccess(_) => {
            AuthCommandError::session_only()
        }
        _ => AuthCommandError::io(),
    }
}

fn entry() -> Result<Entry, AuthCommandError> {
    Entry::new(SERVICE, USER).map_err(classify)
}

#[tauri::command]
pub fn read_token() -> Result<Option<String>, AuthCommandError> {
    let e = entry()?;
    match e.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(classify(err)),
    }
}

#[tauri::command]
pub fn write_token(token: String) -> Result<(), AuthCommandError> {
    entry()?.set_password(&token).map_err(classify)
}

#[tauri::command]
pub fn clear_token() -> Result<(), AuthCommandError> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(classify(err)),
    }
}

// Runtime round-trip testing lives in F-9 (Tauri CI smoke build), where a
// full Tauri runtime is available to exercise these commands via IPC. The
// `keyring` v3 crate no longer ships a `mock` feature, and exercising the
// real OS keychain from `cargo test` requires an unlocked keychain — which
// GitHub Actions runners don't provide by default.
