use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::db::schema::{apply_migrations, ensure_vec_extension};
use crate::embeddings::embedder::Embedder;
use crate::indexer::pipeline::index_document;
use crate::indexer::retrieval::{search, SearchHit};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub embedder: Mutex<Embedder>,
}

impl AppState {
    pub fn new(db_path: &Path) -> anyhow::Result<Self> {
        ensure_vec_extension();
        let conn = Connection::open(db_path)?;
        apply_migrations(&conn)?;
        let embedder = Embedder::new()?;
        Ok(Self {
            db: Mutex::new(conn),
            embedder: Mutex::new(embedder),
        })
    }
}

#[derive(Serialize)]
pub struct DocumentSummary {
    pub id: String,
    pub file_name: String,
    pub page_count: Option<i64>,
    pub indexed_at: Option<i64>,
}

#[tauri::command]
pub async fn index_pdf(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut embedder = state.embedder.lock().map_err(|e| e.to_string())?;
    index_document(&db, &mut embedder, &path_buf).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_private_docs(
    state: State<'_, AppState>,
    query: String,
    top_k: usize,
) -> Result<Vec<SearchHit>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut embedder = state.embedder.lock().map_err(|e| e.to_string())?;
    search(&db, &mut embedder, &query, top_k).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_documents(state: State<'_, AppState>) -> Result<Vec<DocumentSummary>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, file_name, page_count, indexed_at FROM documents ORDER BY indexed_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![], |row| {
            Ok(DocumentSummary {
                id: row.get(0)?,
                file_name: row.get(1)?,
                page_count: row.get(2)?,
                indexed_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut docs = Vec::new();
    for row in rows {
        docs.push(row.map_err(|e| e.to_string())?);
    }
    Ok(docs)
}
