package com.example.finsentinel.service;

import com.example.finsentinel.dto.risk.*;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class PdfReportGeneratorTest {

    private final PdfReportGenerator generator = new PdfReportGenerator();

    private RiskReport sampleReport() {
        return new RiskReport(
                72,
                "HIGH",
                "Portfolio shows elevated concentration risk in technology sector.",
                List.of(
                        new RiskFactor("Market Risk", 75, "High beta exposure"),
                        new RiskFactor("Concentration Risk", 80, "Tech sector >60%")
                ),
                List.of("Diversify into defensive sectors", "Reduce AAPL position by 20%"),
                new ComplianceNote(
                        "This report is for informational purposes only. Not financial advice.",
                        "SEC",
                        true
                )
        );
    }

    @Test
    void generate_returnsPdfBytes() {
        byte[] pdf = generator.generate(sampleReport(), "My Growth Portfolio", LocalDateTime.now());

        assertThat(pdf).isNotNull();
        assertThat(pdf.length).isGreaterThan(1000);
        // PDF magic bytes
        assertThat(new String(pdf, 0, 4)).isEqualTo("%PDF");
    }

    @Test
    void generate_withNullFactors_doesNotThrow() {
        RiskReport report = new RiskReport(50, "MEDIUM", "Summary", null, null,
                new ComplianceNote("Disclaimer", "SEC", true));

        byte[] pdf = generator.generate(report, "Test Portfolio", LocalDateTime.now());
        assertThat(pdf).isNotNull();
        assertThat(new String(pdf, 0, 4)).isEqualTo("%PDF");
    }
}
