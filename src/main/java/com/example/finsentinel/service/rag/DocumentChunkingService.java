package com.example.finsentinel.service.rag;

import com.example.finsentinel.config.RagChunkingProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.ai.document.Document;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Implements document chunking service business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
@RequiredArgsConstructor
public class DocumentChunkingService {

    private final RagChunkingProperties properties;

    /**
     * Executes split.
     *
     * <p>This method belongs to {@link DocumentChunkingService} and encapsulates the
     * split workflow.
     * @param cleanText clean text (String)
     * @param baseMetadata base metadata (Map<String, Object>)
     * @return the split result (List<Document>)
     */

    public List<Document> split(String cleanText, Map<String, Object> baseMetadata) {
        if (!StringUtils.hasText(cleanText)) {

            return List.of();
        }

        TokenTextSplitter splitter = TokenTextSplitter.builder()
                .withChunkSize(properties.getChunkSize())
                .withMinChunkSizeChars(properties.getMinChunkSizeChars())
                .withMaxNumChunks(properties.getMaxNumChunks())
                .withKeepSeparator(true)
                .build();

        List<Document> initial = splitter.apply(List.of(new Document(cleanText, baseMetadata)));


        return applySlidingOverlap(initial, properties.getChunkOverlap(), baseMetadata);
    }

    /**
     * Executes apply sliding overlap.
     *
     * <p>This method belongs to {@link DocumentChunkingService} and encapsulates the
     * apply sliding overlap workflow.
     * @param chunks chunks (List<Document>)
     * @param overlapTokens overlap tokens (int)
     * @param baseMetadata base metadata (Map<String, Object>)
     * @return the apply sliding overlap result (List<Document>)
     */

    private List<Document> applySlidingOverlap(List<Document> chunks,
                                               int overlapTokens,
                                               Map<String, Object> baseMetadata) {
        List<Document> result = new ArrayList<>();
        String previousTail = "";

        for (int i = 0; i < chunks.size(); i++) {
            Document current = chunks.get(i);
            String text = current.getText();
            String merged = previousTail.isBlank() ? text : previousTail + "\n" + text;

            Map<String, Object> metadata = new HashMap<>(baseMetadata);
            metadata.put("chunk_index", i);
            metadata.put("chunk_total", chunks.size());

            result.add(new Document(merged, metadata));
            previousTail = tailByWordCount(text, overlapTokens);
        }
        return result;
    }

    /**
     * Executes tail by word count.
     *
     * <p>This method belongs to {@link DocumentChunkingService} and encapsulates the
     * tail by word count workflow.
     * @param text text (String)
     * @param words words (int)
     * @return the tail by word count result (String)
     */

    private String tailByWordCount(String text, int words) {
        if (words <= 0 || text == null || text.isBlank()) {
            return "";
        }
        String[] arr = text.trim().split("\\s+");
        int start = Math.max(0, arr.length - words);

        return String.join(" ", java.util.Arrays.copyOfRange(arr, start, arr.length));
    }
}
