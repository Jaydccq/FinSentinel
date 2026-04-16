use anyhow::{Context, Result};
use std::path::Path;

/// Result of extracting text from a PDF document.
pub struct ExtractedDoc {
    /// The full extracted text content, with pages joined by newlines.
    pub text: String,
    /// The number of pages in the document.
    pub page_count: usize,
}

/// Extract text content from a PDF file at the given path.
///
/// Uses `pdf-extract` (based on lopdf) for pure-Rust PDF text extraction.
/// Returns the concatenated text of all pages and the total page count.
pub fn extract_pdf(path: &Path) -> Result<ExtractedDoc> {
    let pages = pdf_extract::extract_text_by_pages(path)
        .with_context(|| format!("failed to extract text from PDF: {}", path.display()))?;

    let page_count = pages.len();
    let text = pages.join("\n");

    Ok(ExtractedDoc { text, page_count })
}
