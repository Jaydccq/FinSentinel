package com.example.finsentinel.repository;

import com.example.finsentinel.model.TradeWallet;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Persistence operations for paper trading wallets.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */
public interface TradeWalletRepository extends JpaRepository<TradeWallet, UUID> {

    Optional<TradeWallet> findByUserId(UUID userId);

    boolean existsByUserId(UUID userId);
}
