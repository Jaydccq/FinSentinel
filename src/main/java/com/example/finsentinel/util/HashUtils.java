package com.example.finsentinel.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Shared cryptographic hashing utilities.
 *
 * <p>This class is part of the util layer in FinSentinel.
 */
public final class HashUtils {

    private HashUtils() {}

    /**
     * Computes a truncated SHA-256 hex digest (first 7 characters) of the input string.
     *
     * @param input the string to hash
     * @return the first 7 hex characters of the SHA-256 digest
     * @throws IllegalStateException if SHA-256 algorithm is not available (should never happen)
     */
    public static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash).substring(0, 7);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
