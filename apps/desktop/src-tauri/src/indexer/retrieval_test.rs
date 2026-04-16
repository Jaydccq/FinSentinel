use super::pipeline::index_document;
use super::retrieval::search;
use crate::db::schema::open_in_memory;
use crate::embeddings::embedder::Embedder;
use std::path::PathBuf;

#[test]
fn retrieves_indexed_content() {
    let conn = open_in_memory().unwrap();
    let mut embedder = Embedder::new().unwrap();
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/hello.pdf");
    index_document(&conn, &mut embedder, &fixture).unwrap();

    let results = search(&conn, &mut embedder, "Hello", 5).unwrap();
    assert!(!results.is_empty());
    assert!(
        results[0].content.to_lowercase().contains("hello"),
        "top result should match query, got: {:?}",
        results[0].content
    );
}

#[test]
fn empty_db_returns_empty_results() {
    let conn = open_in_memory().unwrap();
    let mut embedder = Embedder::new().unwrap();
    let results = search(&conn, &mut embedder, "anything", 5).unwrap();
    assert!(results.is_empty());
}
