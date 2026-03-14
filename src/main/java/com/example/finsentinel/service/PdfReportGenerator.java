package com.example.finsentinel.service;

import com.example.finsentinel.dto.risk.RiskFactor;
import com.example.finsentinel.dto.risk.RiskReport;
import com.itextpdf.io.font.constants.StandardFonts;
import com.itextpdf.kernel.colors.ColorConstants;
import com.itextpdf.kernel.colors.DeviceRgb;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.font.PdfFontFactory;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.element.Cell;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.element.Table;
import com.itextpdf.layout.properties.TextAlignment;
import com.itextpdf.layout.properties.UnitValue;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

@Component
@Slf4j
public class PdfReportGenerator {

    private static final DeviceRgb HEADER_BG = new DeviceRgb(30, 58, 138);
    private static final DeviceRgb RISK_HIGH = new DeviceRgb(185, 28, 28);
    private static final DeviceRgb RISK_MEDIUM = new DeviceRgb(180, 83, 9);
    private static final DeviceRgb RISK_LOW = new DeviceRgb(21, 128, 61);
    private static final DeviceRgb ROW_ALT = new DeviceRgb(243, 244, 246);
    private static final DateTimeFormatter TIMESTAMP_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    public byte[] generate(RiskReport report, String portfolioName, LocalDateTime generatedAt) {
        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            PdfFont bold = PdfFontFactory.createFont(StandardFonts.HELVETICA_BOLD);
            PdfFont regular = PdfFontFactory.createFont(StandardFonts.HELVETICA);
            try (PdfWriter writer = new PdfWriter(baos);
                 PdfDocument pdfDoc = new PdfDocument(writer);
                 Document doc = new Document(pdfDoc)) {

                addHeader(doc, bold, regular, portfolioName, generatedAt);
                addRiskScore(doc, bold, report);
                addSummary(doc, bold, regular, report.summary());
                addRiskFactorsTable(doc, bold, regular, report.factors());
                addActionableAdvice(doc, bold, regular, report.actionableAdvice());
            }

            return baos.toByteArray();
        } catch (IOException e) {
            log.error("Failed to generate PDF report", e);

            throw new RuntimeException("PDF generation failed", e);
        }
    }

    private void addHeader(Document doc, PdfFont bold, PdfFont regular,
                           String portfolioName, LocalDateTime generatedAt) {
        doc.add(new Paragraph("FinSentinel — Investment Risk Report")
                .setFont(bold).setFontSize(18)
                .setFontColor(ColorConstants.WHITE)
                .setBackgroundColor(HEADER_BG)
                .setTextAlignment(TextAlignment.CENTER)
                .setMarginBottom(4));

        doc.add(new Paragraph("Portfolio: " + portfolioName)
                .setFont(bold).setFontSize(12)
                .setTextAlignment(TextAlignment.CENTER)
                .setMarginBottom(2));

        String ts = generatedAt.format(TIMESTAMP_FMT);
        doc.add(new Paragraph("Generated: " + ts)
                .setFont(regular).setFontSize(9)
                .setFontColor(ColorConstants.GRAY)
                .setTextAlignment(TextAlignment.CENTER)
                .setMarginBottom(16));
    }

    private void addRiskScore(Document doc, PdfFont bold, RiskReport report) {
        DeviceRgb scoreColor = scoreColor(report.riskLevel());

        doc.add(new Paragraph("Risk Score")
                .setFont(bold).setFontSize(13).setMarginBottom(4));

        doc.add(new Paragraph(report.riskScore() + " / 100")
                .setFont(bold).setFontSize(28)
                .setFontColor(scoreColor)
                .setMarginBottom(2));

        doc.add(new Paragraph("Risk Level: " + report.riskLevel())
                .setFont(bold).setFontSize(13)
                .setFontColor(scoreColor)
                .setMarginBottom(14));
    }

    private void addSummary(Document doc, PdfFont bold, PdfFont regular, String summary) {
        if (summary == null || summary.isBlank()) return;
        doc.add(new Paragraph("Executive Summary")
                .setFont(bold).setFontSize(13).setMarginBottom(4));
        doc.add(new Paragraph(summary)
                .setFont(regular).setFontSize(10).setMarginBottom(14));
    }

    private void addRiskFactorsTable(Document doc, PdfFont bold, PdfFont regular,
                                     List<RiskFactor> factors) {
        doc.add(new Paragraph("Risk Factors")
                .setFont(bold).setFontSize(13).setMarginBottom(6));

        if (factors == null || factors.isEmpty()) {
            doc.add(new Paragraph("No risk factors available.")
                    .setFont(regular).setFontSize(10).setMarginBottom(14));
            return;
        }

        Table table = new Table(UnitValue.createPercentArray(new float[]{30f, 15f, 55f}))
                .useAllAvailableWidth().setMarginBottom(14);

        for (String header : List.of("Category", "Score", "Description")) {
            table.addHeaderCell(new Cell().add(
                    new Paragraph(header).setFont(bold).setFontSize(10)
                            .setFontColor(ColorConstants.WHITE))
                    .setBackgroundColor(HEADER_BG));
        }

        for (int i = 0; i < factors.size(); i++) {
            RiskFactor f = factors.get(i);
            DeviceRgb rowBg = (i % 2 == 1) ? ROW_ALT : null;

            table.addCell(styledCell(f.category(), regular, rowBg));
            table.addCell(styledCell(String.valueOf(f.score()), bold, rowBg)
                    .setTextAlignment(TextAlignment.CENTER));
            table.addCell(styledCell(f.description(), regular, rowBg));
        }

        doc.add(table);
    }

    private void addActionableAdvice(Document doc, PdfFont bold, PdfFont regular,
                                     List<String> advice) {
        doc.add(new Paragraph("Actionable Recommendations")
                .setFont(bold).setFontSize(13).setMarginBottom(6));

        if (advice == null || advice.isEmpty()) {
            doc.add(new Paragraph("No recommendations available.")
                    .setFont(regular).setFontSize(10).setMarginBottom(14));
            return;
        }

        for (int i = 0; i < advice.size(); i++) {
            doc.add(new Paragraph((i + 1) + ". " + advice.get(i))
                    .setFont(regular).setFontSize(10).setMarginBottom(3));
        }
        doc.add(new Paragraph("").setMarginBottom(14));
    }

    private Cell styledCell(String text, PdfFont font, DeviceRgb bg) {
        Cell cell = new Cell().add(
            new Paragraph(text != null ? text : "").setFont(font).setFontSize(10));
        if (bg != null) cell.setBackgroundColor(bg);
        return cell;
    }

    private DeviceRgb scoreColor(String riskLevel) {
        if (riskLevel == null) return RISK_LOW;
        return switch (riskLevel.toUpperCase()) {
            case "HIGH", "CRITICAL" -> RISK_HIGH;
            case "MEDIUM" -> RISK_MEDIUM;
            case "LOW" -> RISK_LOW;
            default -> {
                log.warn("Unknown riskLevel '{}', defaulting to LOW color", riskLevel);
                yield RISK_LOW;
            }
        };
    }
}
