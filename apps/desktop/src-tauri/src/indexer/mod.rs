pub mod chunker;
pub mod extractor;
pub mod pipeline;
pub mod retrieval;

#[cfg(test)]
mod chunker_test;

#[cfg(test)]
mod pipeline_test;

#[cfg(test)]
mod retrieval_test;

#[cfg(test)]
mod extractor_test {
    use super::extractor::extract_pdf;
    use std::path::PathBuf;

    #[test]
    fn extracts_text_from_sample_pdf() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/hello.pdf");
        let doc = extract_pdf(&fixture).expect("extract");
        assert!(doc.text.contains("Hello"), "got text: {:?}", doc.text);
        assert!(doc.page_count >= 1);
    }
}
