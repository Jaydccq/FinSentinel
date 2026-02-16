package com.example.finsentinel.service.document;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class TextCleaningService {

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