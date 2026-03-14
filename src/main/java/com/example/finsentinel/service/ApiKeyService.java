package com.example.finsentinel.service;

import com.example.finsentinel.config.EncryptionProperties;
import com.example.finsentinel.dto.apikey.ApiKeyStatusResponse;
import com.example.finsentinel.model.ApiKeyEntry;
import com.example.finsentinel.repository.ApiKeyRepository;
import com.example.finsentinel.util.AesEncryptionUtil;
import com.example.finsentinel.util.AesEncryptionUtil.EncryptedPayload;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Manages encrypted API key storage, retrieval, and lifecycle operations.
 *
 * <p>Keys are encrypted with AES-256-GCM before persistence. Each encryption
 * uses a unique IV, ensuring identical plaintext values produce different
 * ciphertexts. The service maintains a registry of known key names with
 * human-readable labels and categories.
 *
 * <p>This class belongs to the service layer in FinSentinel.
 */
@Service
@RequiredArgsConstructor
public class ApiKeyService {

    private final ApiKeyRepository apiKeyRepository;
    private final EncryptionProperties encryptionProperties;

    /**
     * Known API key definitions with metadata for the settings UI.
     */
    @Getter
    public enum KnownKey {
        POLYGON_API_KEY("Polygon.io API Key", "market-data"),
        OPENROUTER_API_KEY("OpenRouter API Key", "ai"),
        OKX_API_KEY("OKX API Key", "trading"),
        OKX_SECRET_KEY("OKX Secret Key", "trading"),
        OKX_PASSPHRASE("OKX Passphrase", "trading"),
        ALPACA_API_KEY("Alpaca API Key", "trading"),
        ALPACA_SECRET_KEY("Alpaca Secret Key", "trading"),
        FIRECRAWL_API_KEY("Firecrawl API Key", "market-data"),
        X_BEARER_TOKEN("X (Twitter) Bearer Token", "news"),
        CRYPTO_NEWS_6551_TOKEN("6551.io Crypto News Token", "news"),
        TWITTER_6551_TOKEN("6551.io Twitter Token", "news"),
        FMP_API_KEY("Financial Modeling Prep API Key", "market-data");

        private final String label;
        private final String category;

        KnownKey(String label, String category) {
            this.label = label;
            this.category = category;
        }
    }

    /**
     * Encrypts and saves (or updates) an API key for the given user.
     *
     * @param userId    the owning user's ID
     * @param keyName   the key identifier (should match a {@link KnownKey} name)
     * @param plainValue the plaintext API key value
     */
    @Transactional
    public void saveKey(UUID userId, String keyName, String plainValue) {
        EncryptedPayload payload = AesEncryptionUtil.encrypt(plainValue, encryptionProperties.getAesKey());

        ApiKeyEntry entry = apiKeyRepository.findByUserIdAndKeyName(userId, keyName)
                .orElseGet(() -> ApiKeyEntry.builder()
                        .userId(userId)
                        .keyName(keyName)
                        .build());

        entry.setEncryptedValue(payload.ciphertext());
        entry.setIv(payload.iv());
        apiKeyRepository.save(entry);
    }

    /**
     * Decrypts and returns the stored API key value.
     *
     * @param userId  the owning user's ID
     * @param keyName the key identifier
     * @return the decrypted value, or empty if not stored
     */
    @Transactional(readOnly = true)
    public Optional<String> getDecryptedKey(UUID userId, String keyName) {
        return apiKeyRepository.findByUserIdAndKeyName(userId, keyName)
                .map(entry -> AesEncryptionUtil.decrypt(
                        entry.getEncryptedValue(),
                        entry.getIv(),
                        encryptionProperties.getAesKey()
                ));
    }

    /**
     * Deletes a stored API key.
     *
     * @param userId  the owning user's ID
     * @param keyName the key identifier
     */
    @Transactional
    public void deleteKey(UUID userId, String keyName) {
        apiKeyRepository.deleteByUserIdAndKeyName(userId, keyName);
    }

    /**
     * Returns the configuration status of all known API keys for the user.
     *
     * <p>For each {@link KnownKey}, returns whether it is configured in the
     * database and a masked preview of the last 4 characters if so.
     *
     * @param userId the owning user's ID
     * @return list of status entries for all known keys
     */
    @Transactional(readOnly = true)
    public List<ApiKeyStatusResponse> listKeyStatuses(UUID userId) {
        Map<String, ApiKeyEntry> stored = apiKeyRepository.findByUserId(userId).stream()
                .collect(Collectors.toMap(ApiKeyEntry::getKeyName, e -> e));

        List<ApiKeyStatusResponse> statuses = new ArrayList<>();
        for (KnownKey known : KnownKey.values()) {
            ApiKeyEntry entry = stored.get(known.name());
            boolean configured = entry != null;
            String maskedPreview = null;

            if (configured) {
                String decrypted = AesEncryptionUtil.decrypt(
                        entry.getEncryptedValue(),
                        entry.getIv(),
                        encryptionProperties.getAesKey()
                );
                maskedPreview = maskValue(decrypted);
            }

            statuses.add(new ApiKeyStatusResponse(
                    known.name(),
                    known.getLabel(),
                    configured,
                    maskedPreview,
                    known.getCategory()
            ));
        }
        return statuses;
    }

    /**
     * Returns the effective API key value, preferring the user's stored key
     * over the environment-variable fallback.
     *
     * @param userId      the owning user's ID
     * @param keyName     the key identifier
     * @param envFallback the environment-variable fallback value (may be null or blank)
     * @return the effective key value (user DB key if present, else env fallback)
     */
    @Transactional(readOnly = true)
    public String getEffectiveKey(UUID userId, String keyName, String envFallback) {
        return getDecryptedKey(userId, keyName)
                .orElse(envFallback != null ? envFallback : "");
    }

    /**
     * Masks all but the last 4 characters of a value.
     *
     * @param value the plaintext value
     * @return masked string (e.g. "****abcd")
     */
    static String maskValue(String value) {
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "****" + value.substring(value.length() - 4);
    }
}
