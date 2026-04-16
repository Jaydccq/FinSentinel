use anyhow::{Context, Result};
use fastembed::{EmbeddingModel, TextEmbedding, TextInitOptions};

pub struct Embedder {
    model: TextEmbedding,
}

impl Embedder {
    pub fn new() -> Result<Self> {
        let model = TextEmbedding::try_new(
            TextInitOptions::new(EmbeddingModel::BGESmallENV15)
                .with_show_download_progress(true),
        )
        .context("load BGE small EN v1.5 model")?;
        Ok(Self { model })
    }

    pub fn embed(&mut self, passages: Vec<String>) -> Result<Vec<Vec<f32>>> {
        self.model
            .embed(passages, None)
            .context("fastembed inference")
    }
}
