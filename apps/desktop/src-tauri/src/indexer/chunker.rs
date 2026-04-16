use text_splitter::{ChunkConfig, TextSplitter};
use tiktoken_rs::cl100k_base;

/// Split `text` into token-aware chunks of at most `max_tokens` tokens,
/// with approximately `overlap` tokens of overlap between consecutive chunks.
///
/// Uses the cl100k_base tokenizer (same as GPT-4 / text-embedding-ada-002)
/// for accurate token counting, matching the server-side RAG pipeline semantics.
pub fn chunk_text(text: &str, max_tokens: usize, overlap: usize) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }

    let tokenizer = cl100k_base().expect("failed to load cl100k_base tokenizer");

    // Clamp overlap to be strictly less than max_tokens (library requirement).
    let effective_overlap = if overlap >= max_tokens {
        max_tokens.saturating_sub(1)
    } else {
        overlap
    };

    let config = ChunkConfig::new(max_tokens)
        .with_sizer(tokenizer)
        .with_overlap(effective_overlap)
        .expect("invalid chunk config")
        .with_trim(true);

    let splitter = TextSplitter::new(config);

    splitter.chunks(text).map(String::from).collect()
}
