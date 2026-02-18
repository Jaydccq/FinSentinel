package com.example.finsentinel.controller;

import com.example.finsentinel.dto.portfolio.*;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.dto.risk.RiskReportSummary;
import com.example.finsentinel.mapper.RiskReportMapper;
import com.example.finsentinel.repository.RiskReportRepository;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.PortfolioService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/portfolios")
@RequiredArgsConstructor
public class PortfolioController {

    private final PortfolioService portfolioService;
    private final UserRepository userRepository;
    private final RiskReportRepository riskReportRepository;
    private final RiskReportMapper riskReportMapper;

    @PostMapping
    public ResponseEntity<PortfolioResponse> create(
            @Valid @RequestBody PortfolioRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(portfolioService.create(request, resolveUserId(userDetails)));
    }

    @GetMapping
    public ResponseEntity<List<PortfolioResponse>> list(
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.listByUser(resolveUserId(userDetails)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<PortfolioResponse> get(
            @PathVariable UUID id,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.getById(id, resolveUserId(userDetails)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<PortfolioResponse> update(
            @PathVariable UUID id,
            @Valid @RequestBody PortfolioRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.update(id, request, resolveUserId(userDetails)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID id,
            @AuthenticationPrincipal UserDetails userDetails) {
        portfolioService.delete(id, resolveUserId(userDetails));
        return ResponseEntity.noContent().build();
    }

    // --- Holding sub-resource ---

    @PostMapping("/{portfolioId}/holdings")
    public ResponseEntity<HoldingResponse> addHolding(
            @PathVariable UUID portfolioId,
            @Valid @RequestBody HoldingRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(portfolioService.addHolding(portfolioId, request, resolveUserId(userDetails)));
    }

    @GetMapping("/{portfolioId}/holdings")
    public ResponseEntity<List<HoldingResponse>> listHoldings(
            @PathVariable UUID portfolioId,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.listHoldings(portfolioId, resolveUserId(userDetails)));
    }

    @PutMapping("/{portfolioId}/holdings/{holdingId}")
    public ResponseEntity<HoldingResponse> updateHolding(
            @PathVariable UUID portfolioId,
            @PathVariable UUID holdingId,
            @Valid @RequestBody HoldingRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.updateHolding(
                portfolioId, holdingId, request, resolveUserId(userDetails)));
    }

    @DeleteMapping("/{portfolioId}/holdings/{holdingId}")
    public ResponseEntity<Void> deleteHolding(
            @PathVariable UUID portfolioId,
            @PathVariable UUID holdingId,
            @AuthenticationPrincipal UserDetails userDetails) {
        portfolioService.deleteHolding(portfolioId, holdingId, resolveUserId(userDetails));
        return ResponseEntity.noContent().build();
    }

    // --- Reports sub-resource ---

    @GetMapping("/{id}/reports")
    public ResponseEntity<List<RiskReportSummary>> listReports(
            @PathVariable UUID id,
            @AuthenticationPrincipal UserDetails userDetails) {
        portfolioService.getById(id, resolveUserId(userDetails));
        List<RiskReportSummary> summaries = riskReportRepository
                .findByPortfolioIdOrderByCreatedAtDesc(id)
                .stream()
                .map(entity -> {
                    RiskReport dto = riskReportMapper.toDto(entity);
                    return new RiskReportSummary(
                            entity.getId(),
                            dto.riskScore(),
                            dto.riskLevel(),
                            dto.summary(),
                            dto.factors(),
                            dto.actionableAdvice(),
                            dto.complianceNote(),
                            entity.getCreatedAt()
                    );
                })
                .toList();
        return ResponseEntity.ok(summaries);
    }

    private UUID resolveUserId(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"))
                .getId();
    }
}
