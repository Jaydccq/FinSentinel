use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::chunker::chunk_text;
use super::extractor::extract_pdf;
use crate::embeddings::embedder::Embedder;

/// Index a PDF document: extract text, chunk, embed, and persist to SQLite.
///
/// Returns the document ID (a UUID). If a document with the same SHA-256 hash
/// already exists, returns the existing ID without re-indexing (idempotent).
pub fn index_document(
    conn: &Connection,
    embedder: &mut Embedder,
    path: &Path,
) -> Result<String> {
    // 1. Read file bytes and compute SHA-256
    let file_bytes = std::fs::read(path)
        .with_context(|| format!("failed to read file: {}", path.display()))?;
    let sha256_hex = {
        let mut hasher = Sha256::new();
        hasher.update(&file_bytes);
        format!("{:x}", hasher.finalize())
    };

    // 2. Idempotency check — if sha256 already exists, return the existing doc ID
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM documents WHERE sha256 = ?1",
            params![&sha256_hex],
            |row| row.get(0),
        )
        .ok();

    if let Some(existing_id) = existing {
        return Ok(existing_id);
    }

    // 3. Extract text from PDF
    let extracted = extract_pdf(path)?;

    // 4. Chunk the text
    let chunks = chunk_text(&extracted.text, 800, 100);

    // 5. Embed all chunks
    let embeddings = embedder.embed(chunks.clone())?;

    // 6. Persist everything in a transaction
    let doc_id = Uuid::new_v4().to_string();
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let file_path_str = path.to_string_lossy().to_string();
    let byte_size = file_bytes.len() as i64;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO documents (id, file_name, file_path, sha256, byte_size, page_count, created_at, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            &doc_id,
            &file_name,
            &file_path_str,
            &sha256_hex,
            byte_size,
            extracted.page_count as i64,
            now,
            now,
        ],
    )?;

    for (i, chunk_text) in chunks.iter().enumerate() {
        let chunk_id = Uuid::new_v4().to_string();
        let token_count = chunk_text.len() as i64; // rough byte-length proxy

        tx.execute(
            "INSERT INTO chunks (id, document_id, chunk_index, content, token_count)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![&chunk_id, &doc_id, i as i64, chunk_text, token_count],
        )?;

        // Convert f32 vector to little-endian bytes for sqlite-vec
        let embedding = &embeddings[i];
        let vec_bytes: Vec<u8> = embedding
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();

        tx.execute(
            "INSERT INTO chunk_vectors (chunk_id, embedding) VALUES (?1, ?2)",
            params![&chunk_id, &vec_bytes],
        )?;
    }

    tx.commit()?;

    Ok(doc_id)
}
