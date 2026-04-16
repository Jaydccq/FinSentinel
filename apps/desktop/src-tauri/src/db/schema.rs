use anyhow::Result;
use rusqlite::{ffi::sqlite3_auto_extension, Connection};

const MIGRATION_001: &str = include_str!("../../migrations/001_init.sql");

/// Register the sqlite-vec extension as an auto-extension so every new
/// connection gets it. Safe to call multiple times (SQLite deduplicates).
fn ensure_vec_extension() {
    unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }
}

pub fn apply_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(MIGRATION_001)?;
    Ok(())
}

pub fn open_in_memory() -> Result<Connection> {
    ensure_vec_extension();
    let conn = Connection::open_in_memory()?;
    apply_migrations(&conn)?;
    Ok(conn)
}
