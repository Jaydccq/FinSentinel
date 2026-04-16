use anyhow::Result;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::embeddings::embedder::Embedder;

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub chunk_id: String,
    pub document_id: String,
    pub file_name: String,
    pub content: String,
    pub distance: f32,
}

/// Search indexed chunks by cosine similarity to a query string.
///
/// Embeds `query` using the same model as indexing, then performs KNN search
/// via sqlite-vec's `vec0` virtual table. Returns up to `top_k` results
/// ordered by ascending distance (closest first).
pub fn search(
    conn: &Connection,
    embedder: &mut Embedder,
    query: &str,
    top_k: usize,
) -> Result<Vec<SearchHit>> {
    // 1. Embed the query
    let query_vecs = embedder.embed(vec![query.to_string()])?;
    let query_vec = &query_vecs[0];

    // 2. Convert to little-endian BLOB (same format pipeline.rs uses for inserts)
    let query_bytes: Vec<u8> = query_vec.iter().flat_map(|f| f.to_le_bytes()).collect();

    // 3. KNN search via sqlite-vec's MATCH + k syntax, joined with metadata
    let sql = r#"
        SELECT c.id, c.document_id, d.file_name, c.content, v.distance
        FROM chunk_vectors v
        JOIN chunks c ON c.id = v.chunk_id
        JOIN documents d ON d.id = c.document_id
        WHERE v.embedding MATCH ?1 AND k = ?2
        ORDER BY v.distance
    "#;

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };

    let rows = stmt.query_map(params![&query_bytes, top_k as i64], |row| {
        Ok(SearchHit {
            chunk_id: row.get(0)?,
            document_id: row.get(1)?,
            file_name: row.get(2)?,
            content: row.get(3)?,
            distance: row.get(4)?,
        })
    });

    match rows {
        Ok(mapped) => {
            let mut results = Vec::new();
            for hit in mapped {
                match hit {
                    Ok(h) => results.push(h),
                    Err(_) => continue,
                }
            }
            Ok(results)
        }
        Err(_) => Ok(Vec::new()),
    }
}
