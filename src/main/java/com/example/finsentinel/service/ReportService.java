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

/**
 * Implements report service business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
@RequiredArgsConstructor
@Slf4j
public class ReportService {

    private final RiskReportRepository reportRepository;
    private final RiskReportMapper reportMapper;
    private final PdfReportGenerator pdfGenerator;

    /**
     * Generates pdf.
     *
     * <p>This method is defined in {@link ReportService}.
     * @param reportId report id (UUID)
     * @return the generate pdf result (byte[])
     */

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
