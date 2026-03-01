package com.example.finsentinel.service;

import com.example.finsentinel.dto.auth.AuthResponse;
import com.example.finsentinel.dto.auth.LoginRequest;
import com.example.finsentinel.dto.auth.RegisterRequest;
import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.security.JwtTokenProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Implements auth service business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final AuthenticationManager authenticationManager;

    /**
     * Executes register.
     *
     * <p>This method belongs to {@link AuthService} and encapsulates the
     * register workflow.
     * @param request request (RegisterRequest)
     * @return the register result (AuthResponse)
     */

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByUsername(request.username())) {

            throw new IllegalArgumentException("Username already exists");
        }
        if (userRepository.existsByEmail(request.email())) {

            throw new IllegalArgumentException("Email already exists");
        }

        User user = User.builder()
                .username(request.username())
                .email(request.email())
                .password(passwordEncoder.encode(request.password()))
                .displayName(request.displayName())
                .build();

        try {
            userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException e) {
            String rootMessage = e.getMostSpecificCause() != null
                    ? e.getMostSpecificCause().getMessage()
                    : e.getMessage();
            String normalized = rootMessage == null ? "" : rootMessage.toLowerCase();
            if (normalized.contains("username")) {
                throw new IllegalArgumentException("Username already exists");
            }
            if (normalized.contains("email")) {
                throw new IllegalArgumentException("Email already exists");
            }
            throw new IllegalArgumentException("User already exists");
        }

        String token = jwtTokenProvider.generateToken(user.getUsername(), user.getId());

        return new AuthResponse(token, user.getUsername(), user.getEmail());
    }

    /**
     * Executes login.
     *
     * <p>This method belongs to {@link AuthService} and encapsulates the
     * login workflow.
     * @param request request (LoginRequest)
     * @return the login result (AuthResponse)
     */

    public AuthResponse login(LoginRequest request) {
        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(request.username(), request.password())
        );

        User user = userRepository.findByUsername(request.username())
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        String token = jwtTokenProvider.generateToken(user.getUsername(), user.getId());

        return new AuthResponse(token, user.getUsername(), user.getEmail());
    }
}
