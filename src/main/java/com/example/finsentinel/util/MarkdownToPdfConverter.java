package com.example.finsentinel.util;

import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.properties.TextAlignment;
import lombok.extern.slf4j.Slf4j;

import java.io.ByteArrayOutputStream;

@Slf4j
public final class MarkdownToPdfConverter {

    private MarkdownToPdfConverter() {}

    public static byte[] convert(String title, String markdownContent) {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (PdfDocument pdf = new PdfDocument(new PdfWriter(baos));
             Document document = new Document(pdf)) {

            // Title
            Paragraph titleParagraph = new Paragraph(title)
                    .setFontSize(18)
                    .setBold()
                    .setTextAlignment(TextAlignment.CENTER)
                    .setMarginBottom(20);
            document.add(titleParagraph);

            // Process markdown content into paragraphs
            String[] sections = markdownContent.split("\n\n+");
            for (String section : sections) {
                String trimmed = section.trim();
                if (trimmed.isEmpty()) continue;

                if (trimmed.startsWith("# ")) {
                    document.add(new Paragraph(trimmed.substring(2))
                            .setFontSize(16).setBold().setMarginTop(12));
                } else if (trimmed.startsWith("## ")) {
                    document.add(new Paragraph(trimmed.substring(3))
                            .setFontSize(14).setBold().setMarginTop(10));
                } else if (trimmed.startsWith("### ")) {
                    document.add(new Paragraph(trimmed.substring(4))
                            .setFontSize(12).setBold().setMarginTop(8));
                } else {
                    // Strip remaining markdown formatting for plain text
                    String plain = trimmed
                            .replaceAll("\\*\\*(.+?)\\*\\*", "$1")
                            .replaceAll("\\*(.+?)\\*", "$1")
                            .replaceAll("\\[(.+?)]\\(.+?\\)", "$1")
                            .replaceAll("`(.+?)`", "$1");
                    document.add(new Paragraph(plain).setFontSize(10).setMarginBottom(6));
                }
            }
        }
        return baos.toByteArray();
    }
}
