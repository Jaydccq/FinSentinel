package com.example.finsentinel.controller;

import com.example.finsentinel.dto.auth.AuthResponse;
import com.example.finsentinel.dto.auth.LoginRequest;
import com.example.finsentinel.dto.auth.RegisterRequest;
import com.example.finsentinel.service.AuthService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Exposes REST endpoints for auth controller operations.
 *
 * <p>This class belongs to the controller layer in FinSentinel.
 */

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    /**
     * Executes register.
     *
     * <p>This method is defined in {@link AuthController}.
     * @param request request (RegisterRequest)
     * @return the register result (ResponseEntity<AuthResponse>)
     */

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {

        return ResponseEntity.ok(authService.register(request));
    }

    /**
     * Executes login.
     *
     * <p>This method is defined in {@link AuthController}.
     * @param request request (LoginRequest)
     * @return the login result (ResponseEntity<AuthResponse>)
     */

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {

        return ResponseEntity.ok(authService.login(request));
    }
}
