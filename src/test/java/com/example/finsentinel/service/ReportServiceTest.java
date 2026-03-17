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

/**
 * Implements report service test business operations and integrations.
 *
 * <p>This class belongs to the service layer in FinSentinel.
 */

@ExtendWith(MockitoExtension.class)
class ReportServiceTest {

    @Mock RiskReportRepository reportRepository;
    @Mock RiskReportMapper reportMapper;
    @Mock PdfReportGenerator pdfGenerator;
    @InjectMocks ReportService reportService;


    @Test
    void generatePdf_returnsBytes_whenReportExists() {
        UUID reportId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        Portfolio portfolio = new Portfolio();
        portfolio.setName("Tech Growth");

        RiskReportEntity entity = new RiskReportEntity();
        entity.setPortfolio(portfolio);
        entity.setCreatedAt(LocalDateTime.now());

        RiskReport dto = new RiskReport(72, "HIGH", "Summary",
                List.of(new RiskFactor("Market", 70, "desc")),
                List.of("Rebalance"));

        when(reportRepository.findByIdAndPortfolioUserId(reportId, userId)).thenReturn(Optional.of(entity));
        when(reportMapper.toDto(entity)).thenReturn(dto);
        when(pdfGenerator.generate(any(), any(), any())).thenReturn(new byte[]{37, 80, 68, 70}); // %PDF

        byte[] result = reportService.generatePdf(reportId, userId);

        assertThat(result).isNotNull();
        assertThat(result.length).isGreaterThan(0);
        verify(pdfGenerator).generate(eq(dto), eq("Tech Growth"), any());
    }


    @Test
    void generatePdf_throwsIllegalArgument_whenNotFound() {
        UUID reportId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        when(reportRepository.findByIdAndPortfolioUserId(reportId, userId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> reportService.generatePdf(reportId, userId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Risk report not found");
    }
}
