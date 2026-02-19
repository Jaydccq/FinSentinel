package com.example.finsentinel.repository;

import com.example.finsentinel.model.Portfolio;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * Declares persistence operations for portfolio repository data.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */

public interface PortfolioRepository extends JpaRepository<Portfolio, UUID> {


    List<Portfolio> findByUserId(UUID userId);

    boolean existsByIdAndUserId(UUID id, UUID userId);
}
