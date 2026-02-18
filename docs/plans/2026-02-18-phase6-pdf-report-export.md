# Phase 6: PDF Report Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Export a saved `RiskReportEntity` as a styled, English-language PDF via `GET /api/reports/{id}/pdf`, using iText 8 with a professional layout covering risk score, risk factors, actionable advice, and a compliance disclaimer.

**Architecture:** A new `ReportService` fetches `RiskReportEntity` from the DB and calls a new `PdfReportGenerator` (a pure iText 8 utility class) to render the PDF into a `ByteArrayOutputStream`. The controller streams the bytes back with `Content-Type: application/pdf`. No Chinese font is needed — the CLAUDE.md spec says compliance region is US/SEC, so English-only with iText's built-in Helvetica is sufficient (task 6.2 is satisfied by using iText's bundled font, which handles standard Latin/English text correctly without any extra font files).

**Tech Stack:** Java 21, Spring Boot 4, iText 8 (`com.itextpdf:itext-core:8.0.5` already in build.gradle), Spring Data JPA (`RiskReportRepository` already exists), MapStruct (`RiskReportMapper` already exists).

---

## Existing Code to Know

| File | What it gives you |
|------|-------------------|
| `src/main/java/com/example/finsentinel/model/RiskReportEntity.java` | JPA entity with `id`, `riskScore`, `riskLevel`, `summary`, `factorsJson` (JSONB), `adviceJson` (JSONB), `disclaimer`, `regulatoryFramework`, `createdAt`, `portfolio` (lazy) |
| `src/main/java/com/example/finsentinel/dto/risk/RiskReport.java` | Record: `riskScore`, `riskLevel`, `summary`, `factors` (List<RiskFactor>), `actionableAdvice` (List<String>), `complianceNote` |
| `src/main/java/com/example/finsentinel/dto/risk/RiskFactor.java` | Record: `category`, `score`, `description` |
| `src/main/java/com/example/finsentinel/dto/risk/ComplianceNote.java` | Record: `disclaimer`, `regulatoryFramework`, `isCompliant` |
| `src/main/java/com/example/finsentinel/mapper/RiskReportMapper.java` | Abstract MapStruct mapper: `toDto(RiskReportEntity)` → `RiskReport`, handles JSONB deserialization |
| `src/main/java/com/example/finsentinel/repository/RiskReportRepository.java` | `findById(UUID)` + `findByPortfolioIdOrderByCreatedAtDesc(UUID)` |
| `src/main/java/com/example/finsentinel/controller/GlobalExceptionHandler.java` | Already handles `IllegalArgumentException` → 400, `AccessDeniedException` → 403 |
| `build.gradle` | `implementation 'com.itextpdf:itext-core:8.0.5'` already present |

## iText 8 Key API (reference before coding)

```java
// Core imports you'll need:
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.kernel.colors.ColorConstants;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.font.PdfFontFactory;
import com.itextpdf.io.font.constants.StandardFonts;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.element.Table;
import com.itextpdf.layout.element.Cell;
import com.itextpdf.layout.properties.TextAlignment;
import com.itextpdf.layout.properties.UnitValue;

// Creating a PDF to bytes:
ByteArrayOutputStream baos = new ByteArrayOutputStream();
PdfWriter writer = new PdfWriter(baos);
PdfDocument pdfDoc = new PdfDocument(writer);
Document doc = new Document(pdfDoc);
// ... add content ...
doc.close(); // also closes writer
byte[] bytes = baos.toByteArray();

// Built-in fonts (no file needed):
PdfFont bold = PdfFontFactory.createFont(StandardFonts.HELVETICA_BOLD);
PdfFont regular = PdfFontFactory.createFont(StandardFonts.HELVETICA);

// Table with column widths as percentages of page width:
Table table = new Table(UnitValue.createPercentArray(new float[]{30f, 15f, 55f}))
    .useAllAvailableWidth();
table.addCell(new Cell().add(new Paragraph("Category")));
```

---

## Task 1: `PdfReportGenerator` — Pure PDF Builder

**Files:**
- Create: `src/main/java/com/example/finsentinel/service/PdfReportGenerator.java`
- Test: `src/test/java/com/example/finsentinel/service/PdfReportGeneratorTest.java`

This is a `@Component` with one public method: `byte[] generate(RiskReport report, String portfolioName, java.time.LocalDateTime generatedAt)`.

### Step 1: Write the failing test

```java
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
```

### Step 2: Run test to verify it fails

```bash
./gradlew test --tests "com.example.finsentinel.service.PdfReportGeneratorTest" -q
```
Expected: FAIL — `PdfReportGenerator` class doesn't exist yet.

### Step 3: Implement `PdfReportGenerator`

```java
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

    private static final DeviceRgb HEADER_BG = new DeviceRgb(30, 58, 138);   // dark blue
    private static final DeviceRgb RISK_HIGH = new DeviceRgb(185, 28, 28);   // red
    private static final DeviceRgb RISK_MEDIUM = new DeviceRgb(180, 83, 9);  // amber
    private static final DeviceRgb RISK_LOW = new DeviceRgb(21, 128, 61);    // green
    private static final DeviceRgb ROW_ALT = new DeviceRgb(243, 244, 246);   // light gray

    public byte[] generate(RiskReport report, String portfolioName, LocalDateTime generatedAt) {
        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            PdfWriter writer = new PdfWriter(baos);
            PdfDocument pdfDoc = new PdfDocument(writer);
            Document doc = new Document(pdfDoc);

            PdfFont bold = PdfFontFactory.createFont(StandardFonts.HELVETICA_BOLD);
            PdfFont regular = PdfFontFactory.createFont(StandardFonts.HELVETICA);
            PdfFont oblique = PdfFontFactory.createFont(StandardFonts.HELVETICA_OBLIQUE);

            addHeader(doc, bold, regular, portfolioName, generatedAt);
            addRiskScore(doc, bold, regular, report);
            addSummary(doc, bold, regular, report.summary());
            addRiskFactorsTable(doc, bold, regular, report.factors());
            addActionableAdvice(doc, bold, regular, report.actionableAdvice());
            addComplianceDisclaimer(doc, oblique, report);

            doc.close();
            return baos.toByteArray();
        } catch (IOException e) {
            log.error("Failed to generate PDF report", e);
            throw new RuntimeException("PDF generation failed", e);
        }
    }

    private void addHeader(Document doc, PdfFont bold, PdfFont regular,
                           String portfolioName, LocalDateTime generatedAt) {
        // Title bar
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

        String ts = generatedAt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
        doc.add(new Paragraph("Generated: " + ts)
                .setFont(regular).setFontSize(9)
                .setFontColor(ColorConstants.GRAY)
                .setTextAlignment(TextAlignment.CENTER)
                .setMarginBottom(16));
    }

    private void addRiskScore(Document doc, PdfFont bold, PdfFont regular, RiskReport report) {
        DeviceRgb scoreColor = scoreColor(report.riskLevel());

        doc.add(new Paragraph("Risk Score")
                .setFont(bold).setFontSize(13).setMarginBottom(4));

        doc.add(new Paragraph(String.valueOf(report.riskScore()) + " / 100")
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

        // Header row
        for (String header : List.of("Category", "Score", "Description")) {
            table.addHeaderCell(new Cell().add(
                    new Paragraph(header).setFont(bold).setFontSize(10)
                            .setFontColor(ColorConstants.WHITE))
                    .setBackgroundColor(HEADER_BG));
        }

        // Data rows
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

    private void addComplianceDisclaimer(Document doc, PdfFont oblique, RiskReport report) {
        String disclaimer = (report.complianceNote() != null && report.complianceNote().disclaimer() != null)
                ? report.complianceNote().disclaimer()
                : "This report is for informational purposes only and does not constitute investment advice.";
        String framework = (report.complianceNote() != null && report.complianceNote().regulatoryFramework() != null)
                ? report.complianceNote().regulatoryFramework()
                : "SEC";

        doc.add(new Paragraph("Compliance & Regulatory Notice (" + framework + ")")
                .setFont(oblique).setFontSize(9)
                .setFontColor(ColorConstants.GRAY)
                .setBorderTop(new com.itextpdf.layout.borders.SolidBorder(ColorConstants.LIGHT_GRAY, 1))
                .setMarginTop(10).setMarginBottom(4));

        doc.add(new Paragraph(disclaimer)
                .setFont(oblique).setFontSize(8)
                .setFontColor(ColorConstants.GRAY));
    }

    private Cell styledCell(String text, PdfFont font, DeviceRgb bg) {
        Cell cell = new Cell().add(new Paragraph(text).setFont(font).setFontSize(10));
        if (bg != null) cell.setBackgroundColor(bg);
        return cell;
    }

    private DeviceRgb scoreColor(String riskLevel) {
        if (riskLevel == null) return RISK_LOW;
        return switch (riskLevel.toUpperCase()) {
            case "HIGH", "CRITICAL" -> RISK_HIGH;
            case "MEDIUM" -> RISK_MEDIUM;
            default -> RISK_LOW;
        };
    }
}
```

### Step 4: Run tests

```bash
./gradlew test --tests "com.example.finsentinel.service.PdfReportGeneratorTest" -q
```
Expected: 2 tests PASS.

### Step 5: Commit

```bash
git add src/main/java/com/example/finsentinel/service/PdfReportGenerator.java \
        src/test/java/com/example/finsentinel/service/PdfReportGeneratorTest.java
git commit -m "feat(pdf): add PdfReportGenerator with iText 8 layout"
```

---

## Task 2: `ReportService` — Fetch + Orchestrate

**Files:**
- Create: `src/main/java/com/example/finsentinel/service/ReportService.java`
- Test: `src/test/java/com/example/finsentinel/service/ReportServiceTest.java`

Fetches `RiskReportEntity` by ID, converts to `RiskReport` via `RiskReportMapper`, delegates to `PdfReportGenerator`.

### Step 1: Write the failing test

```java
package com.example.finsentinel.service;

import com.example.finsentinel.dto.risk.*;
import com.example.finsentinel.mapper.RiskReportMapper;
import com.example.finsentinel.model.Portfolio;
import com.example.finsentinel.model.RiskReportEntity;
import com.example.finsentinel.repository.RiskReportRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ReportServiceTest {

    @Mock RiskReportRepository reportRepository;
    @Mock RiskReportMapper reportMapper;
    @Mock PdfReportGenerator pdfGenerator;
    @InjectMocks ReportService reportService;

    @Test
    void generatePdf_returnsBytes_whenReportExists() {
        UUID reportId = UUID.randomUUID();

        Portfolio portfolio = new Portfolio();
        portfolio.setName("Tech Growth");

        RiskReportEntity entity = new RiskReportEntity();
        entity.setPortfolio(portfolio);
        entity.setCreatedAt(LocalDateTime.now());

        RiskReport dto = new RiskReport(72, "HIGH", "Summary",
                List.of(new RiskFactor("Market", 70, "desc")),
                List.of("Rebalance"), new ComplianceNote("Disclaimer", "SEC", true));

        when(reportRepository.findById(reportId)).thenReturn(Optional.of(entity));
        when(reportMapper.toDto(entity)).thenReturn(dto);
        when(pdfGenerator.generate(any(), any(), any())).thenReturn(new byte[]{37, 80, 68, 70}); // %PDF

        byte[] result = reportService.generatePdf(reportId);

        assertThat(result).isNotNull();
        assertThat(result.length).isGreaterThan(0);
        verify(pdfGenerator).generate(eq(dto), eq("Tech Growth"), any());
    }

    @Test
    void generatePdf_throwsIllegalArgument_whenNotFound() {
        UUID reportId = UUID.randomUUID();
        when(reportRepository.findById(reportId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> reportService.generatePdf(reportId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Risk report not found");
    }
}
```

### Step 2: Run test to verify it fails

```bash
./gradlew test --tests "com.example.finsentinel.service.ReportServiceTest" -q
```
Expected: FAIL — `ReportService` doesn't exist.

### Step 3: Implement `ReportService`

```java
package com.example.finsentinel.service;

import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.mapper.RiskReportMapper;
import com.example.finsentinel.model.RiskReportEntity;
import com.example.finsentinel.repository.RiskReportRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class ReportService {

    private final RiskReportRepository reportRepository;
    private final RiskReportMapper reportMapper;
    private final PdfReportGenerator pdfGenerator;

    @Transactional(readOnly = true)
    public byte[] generatePdf(UUID reportId) {
        RiskReportEntity entity = reportRepository.findById(reportId)
                .orElseThrow(() -> new IllegalArgumentException("Risk report not found: " + reportId));

        RiskReport report = reportMapper.toDto(entity);
        String portfolioName = entity.getPortfolio() != null
                ? entity.getPortfolio().getName()
                : "Unknown Portfolio";

        log.info("Generating PDF for report {} (portfolio: {})", reportId, portfolioName);
        return pdfGenerator.generate(report, portfolioName, entity.getCreatedAt());
    }
}
```

### Step 4: Run tests

```bash
./gradlew test --tests "com.example.finsentinel.service.ReportServiceTest" -q
```
Expected: 2 tests PASS.

### Step 5: Commit

```bash
git add src/main/java/com/example/finsentinel/service/ReportService.java \
        src/test/java/com/example/finsentinel/service/ReportServiceTest.java
git commit -m "feat(pdf): add ReportService orchestrating fetch + PDF generation"
```

---

## Task 3: `ReportController` — REST Endpoint

**Files:**
- Create: `src/main/java/com/example/finsentinel/controller/ReportController.java`
- Test: `src/test/java/com/example/finsentinel/controller/ReportControllerTest.java`

Endpoint: `GET /api/reports/{id}/pdf` → `application/pdf` binary response.

### Step 1: Write the failing test

```java
package com.example.finsentinel.controller;

import com.example.finsentinel.service.ReportService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ReportController.class)
class ReportControllerTest {

    @Autowired MockMvc mockMvc;
    @MockBean ReportService reportService;

    @Test
    @WithMockUser
    void downloadPdf_returns200WithPdfContentType() throws Exception {
        UUID reportId = UUID.randomUUID();
        byte[] pdfBytes = {37, 80, 68, 70, 45}; // %PDF-
        when(reportService.generatePdf(reportId)).thenReturn(pdfBytes);

        mockMvc.perform(get("/api/reports/{id}/pdf", reportId))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF))
                .andExpect(header().string("Content-Disposition",
                        "attachment; filename=\"risk-report-" + reportId + ".pdf\""))
                .andExpect(content().bytes(pdfBytes));
    }

    @Test
    @WithMockUser
    void downloadPdf_returns400_whenNotFound() throws Exception {
        UUID reportId = UUID.randomUUID();
        when(reportService.generatePdf(reportId))
                .thenThrow(new IllegalArgumentException("Risk report not found: " + reportId));

        mockMvc.perform(get("/api/reports/{id}/pdf", reportId))
                .andExpect(status().isBadRequest());
    }

    @Test
    void downloadPdf_returns401_whenUnauthenticated() throws Exception {
        mockMvc.perform(get("/api/reports/{id}/pdf", UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
    }
}
```

### Step 2: Run test to verify it fails

```bash
./gradlew test --tests "com.example.finsentinel.controller.ReportControllerTest" -q
```
Expected: FAIL — `ReportController` doesn't exist.

### Step 3: Implement `ReportController`

```java
package com.example.finsentinel.controller;

import com.example.finsentinel.service.ReportService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/reports")
@RequiredArgsConstructor
public class ReportController {

    private final ReportService reportService;

    @GetMapping(value = "/{id}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> downloadPdf(@PathVariable UUID id) {
        byte[] pdf = reportService.generatePdf(id);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename("risk-report-" + id + ".pdf")
                .build());

        return ResponseEntity.ok()
                .headers(headers)
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdf);
    }
}
```

### Step 4: Run tests

```bash
./gradlew test --tests "com.example.finsentinel.controller.ReportControllerTest" -q
```
Expected: 3 tests PASS.

### Step 5: Commit

```bash
git add src/main/java/com/example/finsentinel/controller/ReportController.java \
        src/test/java/com/example/finsentinel/controller/ReportControllerTest.java
git commit -m "feat(pdf): add GET /api/reports/{id}/pdf endpoint"
```

---

## Task 4: Full Test Suite Verification

### Step 1: Run all tests

```bash
./gradlew test -q
```
Expected: All tests PASS (was 52, now 52 + 7 new = 59 tests).

### Step 2: Update task_plan.md

Mark Phase 6 complete in `task_plan.md`:

```markdown
## Phase 6: PDF Report Export ✅ COMPLETE

| Task | Owner | Status |
|------|-------|--------|
| 6.1 iText 8 PDF generator | 🧑 | ✅ PdfReportGenerator with styled layout (header, score, factors table, advice, disclaimer) |
| 6.2 Font support | 🧑 | ✅ iText built-in Helvetica (English/SEC region) — no external font files needed |
| 6.3 GET /api/reports/{id}/pdf | 🧑 | ✅ ReportController → ReportService → PdfReportGenerator |
```

### Step 3: Commit + push

```bash
git add task_plan.md
git commit -m "docs: mark Phase 6 PDF export complete"
bash /Users/hongxichen/.claude/skills/git-pushing/scripts/smart_commit.sh
```

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `service/PdfReportGenerator.java` | iText 8 PDF builder — pure function, no DB access |
| `service/ReportService.java` | Orchestrator: fetch entity → map to DTO → generate PDF |
| `controller/ReportController.java` | `GET /api/reports/{id}/pdf` → `application/pdf` |
| `service/PdfReportGeneratorTest.java` | PDF byte validity tests |
| `service/ReportServiceTest.java` | Mock-based unit tests for orchestration |
| `controller/ReportControllerTest.java` | MockMvc tests for HTTP contract |
