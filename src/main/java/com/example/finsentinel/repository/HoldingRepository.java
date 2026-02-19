package com.example.finsentinel.repository;

import com.example.finsentinel.model.Holding;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * Declares persistence operations for holding repository data.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */

public interface HoldingRepository extends JpaRepository<Holding, UUID> {


    List<Holding> findByPortfolioId(UUID portfolioId);


    List<Holding> findBySymbol(String symbol);
}
