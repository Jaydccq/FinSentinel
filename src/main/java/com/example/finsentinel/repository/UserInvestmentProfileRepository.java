package com.example.finsentinel.repository;

import com.example.finsentinel.model.UserInvestmentProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Declares persistence operations for user investment profile data.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */
public interface UserInvestmentProfileRepository extends JpaRepository<UserInvestmentProfile, UUID> {

    Optional<UserInvestmentProfile> findByUserId(UUID userId);

    boolean existsByUserId(UUID userId);
}
