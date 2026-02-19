package com.example.finsentinel.service.document;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.tika.exception.TikaException;
import org.apache.tika.extractor.EmbeddedDocumentExtractor;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.parser.AutoDetectParser;
import org.apache.tika.parser.ParseContext;
import org.apache.tika.parser.pdf.PDFParserConfig;
import org.apache.tika.sax.BodyContentHandler;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.xml.sax.SAXException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Implements document parse service business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
@Slf4j
@RequiredArgsConstructor
public class DocumentParseService {

    private static final int MAX_CHARS = 1_000_000;

    private final TextCleaningService textCleaningService;

    /**
     * Parses to clean text.
     *
     * <p>This method belongs to {@link DocumentParseService} and encapsulates the
     * parse to clean text workflow.
     * @param file file (MultipartFile)
     * @return the parse to clean text result (String)
     */

    public String parseToCleanText(MultipartFile file) {
        try (var inputStream = file.getInputStream()) {

            return parseInputStream(inputStream, file.getOriginalFilename());
        } catch (IOException e) {

            throw new IllegalArgumentException("Document parsing failed\n: " + file.getOriginalFilename(), e);
        }
    }

    /**
     * Parses to clean text.
     *
     * <p>This method belongs to {@link DocumentParseService} and encapsulates the
     * parse to clean text workflow.
     * @param bytes bytes (byte[])
     * @param fileName file name (String)
     * @return the parse to clean text result (String)
     */

    public String parseToCleanText(byte[] bytes, String fileName) {
        try (var inputStream = new ByteArrayInputStream(bytes)) {

            return parseInputStream(inputStream, fileName);
        } catch (IOException e) {

            throw new IllegalArgumentException("Document parsing failed\n: " + fileName, e);
        }
    }

    /**  Parser + Context */
    private String parseInputStream(InputStream inputStream, String fileName) {
        try {
            AutoDetectParser parser = new AutoDetectParser();
            Metadata metadata = new Metadata();
            BodyContentHandler handler = new BodyContentHandler(MAX_CHARS);

            ParseContext context = new ParseContext();
            context.set(EmbeddedDocumentExtractor.class, new NoOpEmbeddedDocumentExtractor());

            PDFParserConfig pdfParserConfig = new PDFParserConfig();
            pdfParserConfig.setExtractInlineImages(false);
            pdfParserConfig.setExtractUniqueInlineImagesOnly(false);
            context.set(PDFParserConfig.class, pdfParserConfig);

            parser.parse(inputStream, handler, metadata, context);

            String cleaned = textCleaningService.clean(handler.toString());
            log.info("Parsed file={}, contentType={}, chars={}",
                    fileName,
                    metadata.get(Metadata.CONTENT_TYPE),
                    cleaned.length());

            return cleaned;
        } catch (IOException | TikaException | SAXException e) {

            throw new IllegalArgumentException("Document parsing failed\n: " + fileName, e);
        }
    }
}
