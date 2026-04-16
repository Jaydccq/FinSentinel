use super::pipeline::index_document;
use crate::db::schema::open_in_memory;
use crate::embeddings::embedder::Embedder;
use std::path::PathBuf;

#[test]
fn indexes_a_pdf_end_to_end() {
    let conn = open_in_memory().unwrap();
    let mut embedder = Embedder::new().unwrap();
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/hello.pdf");

    let doc_id = index_document(&conn, &mut embedder, &fixture).expect("index");

    let doc_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM documents WHERE id = ?1", [&doc_id], |r| r.get(0))
        .unwrap();
    assert_eq!(doc_count, 1);

    let chunk_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM chunks WHERE document_id = ?1", [&doc_id], |r| r.get(0))
        .unwrap();
    assert!(chunk_count >= 1);

    let vec_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chunk_vectors WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?1)",
            [&doc_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(vec_count, chunk_count, "every chunk must have a vector");
}

#[test]
fn indexing_same_file_twice_is_idempotent() {
    let conn = open_in_memory().unwrap();
    let mut embedder = Embedder::new().unwrap();
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/hello.pdf");

    let id1 = index_document(&conn, &mut embedder, &fixture).unwrap();
    let id2 = index_document(&conn, &mut embedder, &fixture).unwrap();
    assert_eq!(id1, id2, "same sha256 → same doc id");

    let doc_count: i64 = conn.query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0)).unwrap();
    assert_eq!(doc_count, 1);
}
