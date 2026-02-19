package com.example.finsentinel.service.document;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Implements text cleaning service business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
public class TextCleaningService {

    /**
     * Executes clean.
     *
     * <p>This method belongs to {@link TextCleaningService} and encapsulates the
     * clean workflow.
     * @param raw raw (String)
     * @return the clean result (String)
     */

    public String clean(String raw) {
        if (!StringUtils.hasText(raw)) {
            return "";
        }

        String text = raw;
        text = text.replaceAll("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "");
        text = text.replaceAll("(?m)^image\\d+\\.(png|jpe?g|gif|bmp|webp)\\s*$", "");
        text = text.replaceAll("https?://\\S+?\\.(png|jpe?g|gif|bmp|webp)(\\?\\S*)?", "");
        text = text.replaceAll("file:(//)?\\S+", "");
        text = text.replaceAll("(?m)^[-_*=]{3,}$", "");
        text = text.replaceAll("<[^>]+>", " ");
        text = text.replaceAll("[ \\t]{2,}", " ");
        text = text.replaceAll("\\n{3,}", "\\n\\n");


        return text.trim();
    }
}
