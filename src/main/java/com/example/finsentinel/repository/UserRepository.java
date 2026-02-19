package com.example.finsentinel.repository;

import com.example.finsentinel.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Declares persistence operations for user repository data.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */

public interface UserRepository extends JpaRepository<User, UUID> {


    Optional<User> findByUsername(String username);


    Optional<User> findByEmail(String email);


    boolean existsByUsername(String username);


    boolean existsByEmail(String email);
}
