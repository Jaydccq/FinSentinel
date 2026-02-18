package com.example.finsentinel.controller;

import com.example.finsentinel.config.SecurityConfig;
import com.example.finsentinel.security.JwtTokenProvider;
import com.example.finsentinel.service.ReportService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ReportController.class)
@Import(SecurityConfig.class)
class ReportControllerTest {

    @Autowired MockMvc mockMvc;
    @MockitoBean ReportService reportService;
    @MockitoBean JwtTokenProvider jwtTokenProvider;
    @MockitoBean UserDetailsService userDetailsService;

    @Test
    void downloadPdf_returns200WithPdfContentType() throws Exception {
        UUID reportId = UUID.randomUUID();
        byte[] pdfBytes = {37, 80, 68, 70, 45}; // %PDF-
        when(reportService.generatePdf(reportId)).thenReturn(pdfBytes);

        mockMvc.perform(get("/api/reports/{id}/pdf", reportId)
                        .with(SecurityMockMvcRequestPostProcessors.user("user")))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF))
                .andExpect(header().string("Content-Disposition",
                        "attachment; filename=\"risk-report-" + reportId + ".pdf\""))
                .andExpect(content().bytes(pdfBytes));
    }

    @Test
    void downloadPdf_returns400_whenNotFound() throws Exception {
        UUID reportId = UUID.randomUUID();
        when(reportService.generatePdf(reportId))
                .thenThrow(new IllegalArgumentException("Risk report not found: " + reportId));

        mockMvc.perform(get("/api/reports/{id}/pdf", reportId)
                        .with(SecurityMockMvcRequestPostProcessors.user("user")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void downloadPdf_returns401_whenUnauthenticated() throws Exception {
        mockMvc.perform(get("/api/reports/{id}/pdf", UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
    }
}
