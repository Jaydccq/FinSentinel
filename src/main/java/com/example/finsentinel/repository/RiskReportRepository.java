package com.example.finsentinel.repository;

import com.example.finsentinel.model.RiskReportEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RiskReportRepository extends JpaRepository<RiskReportEntity, UUID> {

    List<RiskReportEntity> findByPortfolioIdOrderByCreatedAtDesc(UUID portfolioId);

    Optional<RiskReportEntity> findFirstByPortfolioIdOrderByCreatedAtDesc(UUID portfolioId);
}
