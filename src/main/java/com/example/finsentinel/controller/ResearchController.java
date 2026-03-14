package com.example.finsentinel.controller;

import com.example.finsentinel.dto.research.CompanyProfile;
import com.example.finsentinel.dto.research.FinancialMetrics;
import com.example.finsentinel.service.research.CompanyResearchService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST endpoints for company research data (profile, financials).
 *
 * <p>Delegates to {@link CompanyResearchService} which fetches data via the
 * configured {@link com.example.finsentinel.service.research.ResearchDataProvider}.
 */
@RestController
@RequestMapping("/api/research")
@RequiredArgsConstructor
public class ResearchController {

    private final CompanyResearchService companyResearchService;

    @GetMapping("/profile/{ticker}")
    public ResponseEntity<CompanyProfile> getProfile(@PathVariable String ticker) {
        CompanyProfile profile = companyResearchService.getCompanyProfile(ticker);
        if (profile == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(profile);
    }

    @GetMapping("/financials/{ticker}")
    public ResponseEntity<List<FinancialMetrics>> getFinancials(
            @PathVariable String ticker,
            @RequestParam(defaultValue = "4") int periods) {
        return ResponseEntity.ok(companyResearchService.getFinancialMetrics(ticker, periods));
    }
}
