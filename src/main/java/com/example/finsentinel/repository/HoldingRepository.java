package com.example.finsentinel.repository;

import com.example.finsentinel.model.Holding;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface HoldingRepository extends JpaRepository<Holding, UUID> {

    List<Holding> findByPortfolioId(UUID portfolioId);

    List<Holding> findBySymbol(String symbol);
}
