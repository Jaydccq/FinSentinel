package com.example.finsentinel.util;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * AES-256-GCM encryption utility for securing API keys at rest.
 *
 * <p>Uses a 256-bit key with a 12-byte random IV and 128-bit authentication tag.
 * The IV is generated fresh for each encryption operation, ensuring unique
 * ciphertexts even for identical plaintexts.
 *
 * <p>This class belongs to the util layer in FinSentinel.
 */
public final class AesEncryptionUtil {

    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int GCM_TAG_LENGTH = 128;
    private static final int IV_LENGTH = 12;

    private AesEncryptionUtil() {}

    /**
     * Holds the Base64-encoded ciphertext and IV produced by encryption.
     */
    public record EncryptedPayload(String ciphertext, String iv) {}

    /**
     * Encrypts a plaintext string using AES-256-GCM.
     *
     * @param plaintext  the value to encrypt
     * @param base64Key  the AES key encoded as Base64
     * @return an {@link EncryptedPayload} containing Base64-encoded ciphertext and IV
     * @throws IllegalStateException if encryption fails
     */
    public static EncryptedPayload encrypt(String plaintext, String base64Key) {
        try {
            byte[] key = Base64.getDecoder().decode(base64Key);
            SecretKeySpec keySpec = new SecretKeySpec(key, "AES");

            byte[] iv = new byte[IV_LENGTH];
            new SecureRandom().nextBytes(iv);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, new GCMParameterSpec(GCM_TAG_LENGTH, iv));

            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(java.nio.charset.StandardCharsets.UTF_8));

            return new EncryptedPayload(
                    Base64.getEncoder().encodeToString(ciphertext),
                    Base64.getEncoder().encodeToString(iv)
            );
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("AES-GCM encryption failed", e);
        }
    }

    /**
     * Decrypts a Base64-encoded ciphertext using AES-256-GCM.
     *
     * @param ciphertext the Base64-encoded ciphertext
     * @param base64Iv   the Base64-encoded IV used during encryption
     * @param base64Key  the AES key encoded as Base64
     * @return the decrypted plaintext
     * @throws IllegalStateException if decryption fails (wrong key, tampered data, etc.)
     */
    public static String decrypt(String ciphertext, String base64Iv, String base64Key) {
        try {
            byte[] key = Base64.getDecoder().decode(base64Key);
            SecretKeySpec keySpec = new SecretKeySpec(key, "AES");

            byte[] iv = Base64.getDecoder().decode(base64Iv);
            byte[] encryptedBytes = Base64.getDecoder().decode(ciphertext);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, keySpec, new GCMParameterSpec(GCM_TAG_LENGTH, iv));

            byte[] plainBytes = cipher.doFinal(encryptedBytes);

            return new String(plainBytes, java.nio.charset.StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("AES-GCM decryption failed", e);
        }
    }
}
