use super::chunker::chunk_text;

#[test]
fn splits_short_text_into_single_chunk() {
    let chunks = chunk_text("Hello, world.", 800, 100);
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0], "Hello, world.");
}

#[test]
fn splits_long_text_into_multiple_chunks() {
    let big = "word ".repeat(2000);
    let chunks = chunk_text(&big, 500, 50);
    assert!(chunks.len() >= 3, "expected >=3 chunks, got {}", chunks.len());
}

#[test]
fn preserves_content_when_joined() {
    let text = "Alpha. Beta. Gamma. Delta. Epsilon. Zeta.";
    let chunks = chunk_text(text, 10, 2);
    let rejoined: String = chunks.join(" ");
    for word in ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"] {
        assert!(rejoined.contains(word), "lost word: {}", word);
    }
}
