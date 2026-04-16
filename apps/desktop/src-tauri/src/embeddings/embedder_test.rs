use super::embedder::Embedder;

#[test]
fn embeds_a_single_passage_to_384_dims() {
    let mut embedder = Embedder::new().expect("init embedder");
    let vecs = embedder
        .embed(vec!["Hello, FinSentinel.".to_string()])
        .unwrap();
    assert_eq!(vecs.len(), 1);
    assert_eq!(vecs[0].len(), 384, "bge-small outputs 384 dims");
}

#[test]
fn embeddings_are_deterministic() {
    let mut embedder = Embedder::new().unwrap();
    let a = embedder.embed(vec!["same input".to_string()]).unwrap();
    let b = embedder.embed(vec!["same input".to_string()]).unwrap();
    assert_eq!(a[0], b[0], "same input must produce identical vector");
}
