package com.example.finsentinel.service.document;

import org.apache.tika.extractor.EmbeddedDocumentExtractor;
import org.apache.tika.metadata.Metadata;
import org.xml.sax.ContentHandler;
import org.xml.sax.SAXException;

import java.io.IOException;
import java.io.InputStream;

/**
 *
 * @author HongxiChen
 * @version 1.0 2/16/26
 */
public class NoOpEmbeddedDocumentExtractor implements EmbeddedDocumentExtractor {

    /**
     * Executes should parse embedded.
     *
     * <p>This method belongs to {@link NoOpEmbeddedDocumentExtractor} and encapsulates the
     * should parse embedded workflow.
     * @param metadata metadata (Metadata)
     * @return true when should parse embedded succeeds; otherwise false
     */

    @Override
    public boolean shouldParseEmbedded(Metadata metadata) {
        return false;
    }

    /**
     * Parses embedded.
     *
     * <p>This method belongs to {@link NoOpEmbeddedDocumentExtractor} and encapsulates the
     * parse embedded workflow.
     * @param inputStream input stream (InputStream)
     * @param contentHandler content handler (ContentHandler)
     * @param metadata metadata (Metadata)
     * @param b b (boolean)
     * @throws SAXException if the operation cannot be completed
     * @throws IOException if the operation cannot be completed
     */

    @Override
    public void parseEmbedded(InputStream inputStream, ContentHandler contentHandler, Metadata metadata, boolean b) throws SAXException, IOException {

    }
}
