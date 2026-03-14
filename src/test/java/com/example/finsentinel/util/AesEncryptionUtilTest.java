package com.example.finsentinel.util;

import com.example.finsentinel.util.AesEncryptionUtil.EncryptedPayload;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import javax.crypto.KeyGenerator;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Tests for {@link AesEncryptionUtil} AES-256-GCM encryption and decryption.
 *
 * <p>This class belongs to the util test layer in FinSentinel.
 */
class AesEncryptionUtilTest {

    private static String testKey;

    @BeforeAll
    static void generateKey() throws NoSuchAlgorithmException {
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        testKey = Base64.getEncoder().encodeToString(keyGen.generateKey().getEncoded());
    }

    @Test
    void encryptThenDecrypt_roundtrip() {
        String plaintext = "sk-or-v1-my-secret-api-key-12345";

        EncryptedPayload payload = AesEncryptionUtil.encrypt(plaintext, testKey);
        assertThat(payload.ciphertext()).isNotBlank();
        assertThat(payload.iv()).isNotBlank();

        String decrypted = AesEncryptionUtil.decrypt(payload.ciphertext(), payload.iv(), testKey);
        assertThat(decrypted).isEqualTo(plaintext);
    }

    @Test
    void encryptThenDecrypt_emptyString() {
        String plaintext = "";

        EncryptedPayload payload = AesEncryptionUtil.encrypt(plaintext, testKey);
        String decrypted = AesEncryptionUtil.decrypt(payload.ciphertext(), payload.iv(), testKey);

        assertThat(decrypted).isEqualTo(plaintext);
    }

    @Test
    void encryptThenDecrypt_unicodeContent() {
        String plaintext = "api-key-with-unicode-\u00e9\u00e8\u00ea-\u4e2d\u6587";

        EncryptedPayload payload = AesEncryptionUtil.encrypt(plaintext, testKey);
        String decrypted = AesEncryptionUtil.decrypt(payload.ciphertext(), payload.iv(), testKey);

        assertThat(decrypted).isEqualTo(plaintext);
    }

    @Test
    void encrypt_differentPlaintexts_produceDifferentCiphertexts() {
        EncryptedPayload payload1 = AesEncryptionUtil.encrypt("key-one", testKey);
        EncryptedPayload payload2 = AesEncryptionUtil.encrypt("key-one", testKey);

        // Same plaintext should produce different ciphertexts due to unique IVs
        assertThat(payload1.ciphertext()).isNotEqualTo(payload2.ciphertext());
        assertThat(payload1.iv()).isNotEqualTo(payload2.iv());
    }

    @Test
    void decrypt_withWrongKey_throwsException() throws NoSuchAlgorithmException {
        String plaintext = "secret-value";
        EncryptedPayload payload = AesEncryptionUtil.encrypt(plaintext, testKey);

        // Generate a different key
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        String wrongKey = Base64.getEncoder().encodeToString(keyGen.generateKey().getEncoded());

        assertThatThrownBy(() ->
                AesEncryptionUtil.decrypt(payload.ciphertext(), payload.iv(), wrongKey))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("AES-GCM decryption failed");
    }

    @Test
    void decrypt_withTamperedCiphertext_throwsException() {
        String plaintext = "secret-value";
        EncryptedPayload payload = AesEncryptionUtil.encrypt(plaintext, testKey);

        // Tamper with the ciphertext by decoding, flipping a byte, and re-encoding
        byte[] cipherBytes = Base64.getDecoder().decode(payload.ciphertext());
        cipherBytes[0] = (byte) (cipherBytes[0] ^ 0xFF);
        String tampered = Base64.getEncoder().encodeToString(cipherBytes);

        assertThatThrownBy(() ->
                AesEncryptionUtil.decrypt(tampered, payload.iv(), testKey))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("AES-GCM decryption failed");
    }

    @Test
    void encrypt_producesBase64EncodedOutput() {
        EncryptedPayload payload = AesEncryptionUtil.encrypt("test", testKey);

        // Verify outputs are valid Base64
        byte[] ciphertextBytes = Base64.getDecoder().decode(payload.ciphertext());
        byte[] ivBytes = Base64.getDecoder().decode(payload.iv());

        assertThat(ciphertextBytes).isNotEmpty();
        assertThat(ivBytes).hasSize(12); // 12-byte IV for GCM
    }
}
