package com.example.finsentinel.controller;

import com.example.finsentinel.dto.auth.AuthResponse;
import com.example.finsentinel.dto.auth.LoginRequest;
import com.example.finsentinel.dto.auth.RegisterRequest;
import com.example.finsentinel.service.AuthService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

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
    private static final String AUTH_COOKIE_NAME = "FS_AUTH";
    private static final Duration AUTH_COOKIE_TTL = Duration.ofDays(1);

    /**
     * Executes register.
     *
     * <p>This method is defined in {@link AuthController}.
     * @param request request (RegisterRequest)
     * @return the register result (ResponseEntity<AuthResponse>)
     */

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request,
                                                 HttpServletResponse response) {
        AuthResponse authResponse = authService.register(request);
        response.addHeader(HttpHeaders.SET_COOKIE, buildAuthCookie(authResponse.token()).toString());
        return ResponseEntity.ok(authResponse);
    }

    /**
     * Executes login.
     *
     * <p>This method is defined in {@link AuthController}.
     * @param request request (LoginRequest)
     * @return the login result (ResponseEntity<AuthResponse>)
     */

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request,
                                              HttpServletResponse response) {
        AuthResponse authResponse = authService.login(request);
        response.addHeader(HttpHeaders.SET_COOKIE, buildAuthCookie(authResponse.token()).toString());
        return ResponseEntity.ok(authResponse);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletResponse response) {
        ResponseCookie clearCookie = ResponseCookie.from(AUTH_COOKIE_NAME, "")
                .httpOnly(true)
                .secure(false)
                .sameSite("Lax")
                .path("/")
                .maxAge(0)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, clearCookie.toString());
        return ResponseEntity.noContent().build();
    }

    private ResponseCookie buildAuthCookie(String token) {
        return ResponseCookie.from(AUTH_COOKIE_NAME, token)
                .httpOnly(true)
                .secure(false)
                .sameSite("Lax")
                .path("/")
                .maxAge(AUTH_COOKIE_TTL)
                .build();
    }
}
