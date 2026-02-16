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

    @Override
    public boolean shouldParseEmbedded(Metadata metadata) {
        return false;
    }

    @Override
    public void parseEmbedded(InputStream inputStream, ContentHandler contentHandler, Metadata metadata, boolean b) throws SAXException, IOException {

    }
}
