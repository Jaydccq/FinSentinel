package com.example.finsentinel.security;

import com.example.finsentinel.config.JwtProperties;
import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

/**
 * Provides security infrastructure for jwt token provider concerns.
 *
 * <p>This class is part of the security layer in FinSentinel.
 */

@Component
@RequiredArgsConstructor
public class JwtTokenProvider {

    private final JwtProperties jwtProperties;

    /**
     * Returns signing key.
     *
     * <p>This method belongs to {@link JwtTokenProvider} and encapsulates the
     * get signing key workflow.
     * @return the get signing key result (SecretKey)
     */

    private SecretKey getSigningKey() {

        return Keys.hmacShaKeyFor(jwtProperties.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Generates token with embedded userId claim.
     *
     * <p>This method belongs to {@link JwtTokenProvider} and encapsulates the
     * generate token workflow.
     * @param username username (String)
     * @param userId userId (UUID)
     * @return the generate token result (String)
     */

    public String generateToken(String username, UUID userId) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + jwtProperties.getExpiration());

        return Jwts.builder()
                .subject(username)
                .claim("uid", userId.toString())
                .issuedAt(now)
                .expiration(expiryDate)
                .signWith(getSigningKey())
                .compact();
    }

    /**
     * Returns username from token.
     *
     * <p>This method belongs to {@link JwtTokenProvider} and encapsulates the
     * get username from token workflow.
     * @param token token (String)
     * @return the get username from token result (String)
     */

    public String getUsernameFromToken(String token) {

        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .getSubject();
    }

    /**
     * Returns userId from token.
     *
     * <p>This method belongs to {@link JwtTokenProvider} and encapsulates the
     * get userId from token workflow.
     * @param token token (String)
     * @return the userId (UUID) or null if not present
     */

    public UUID getUserIdFromToken(String token) {
        String uid = Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get("uid", String.class);
        return uid != null ? UUID.fromString(uid) : null;
    }

    /**
     * Validates token.
     *
     * <p>This method belongs to {@link JwtTokenProvider} and encapsulates the
     * validate token workflow.
     * @param token token (String)
     * @return true when validate token succeeds; otherwise false
     */

    public boolean validateToken(String token) {
        try {
            Jwts.parser()
                    .verifyWith(getSigningKey())
                    .build()
                    .parseSignedClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }
}
