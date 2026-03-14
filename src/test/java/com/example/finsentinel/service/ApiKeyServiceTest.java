package com.example.finsentinel.service;

import com.example.finsentinel.config.EncryptionProperties;
import com.example.finsentinel.dto.apikey.ApiKeyStatusResponse;
import com.example.finsentinel.model.ApiKeyEntry;
import com.example.finsentinel.repository.ApiKeyRepository;
import com.example.finsentinel.service.ApiKeyService.KnownKey;
import com.example.finsentinel.util.AesEncryptionUtil;
import com.example.finsentinel.util.AesEncryptionUtil.EncryptedPayload;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import javax.crypto.KeyGenerator;
import java.security.NoSuchAlgorithmException;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Tests for {@link ApiKeyService} encrypted API key management operations.
 *
 * <p>This class belongs to the service test layer in FinSentinel.
 */
@ExtendWith(MockitoExtension.class)
class ApiKeyServiceTest {

    @Mock
    private ApiKeyRepository apiKeyRepository;

    private EncryptionProperties encryptionProperties;
    private ApiKeyService apiKeyService;

    private final UUID userId = UUID.randomUUID();
    private String testKey;

    @BeforeEach
    void setUp() throws NoSuchAlgorithmException {
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        testKey = Base64.getEncoder().encodeToString(keyGen.generateKey().getEncoded());

        encryptionProperties = new EncryptionProperties();
        encryptionProperties.setAesKey(testKey);

        apiKeyService = new ApiKeyService(apiKeyRepository, encryptionProperties);
    }

    @Test
    void saveKey_newKey_encryptsAndPersists() {
        when(apiKeyRepository.findByUserIdAndKeyName(userId, "POLYGON_API_KEY"))
                .thenReturn(Optional.empty());
        when(apiKeyRepository.save(any(ApiKeyEntry.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        apiKeyService.saveKey(userId, "POLYGON_API_KEY", "pk_test_12345678");

        ArgumentCaptor<ApiKeyEntry> captor = ArgumentCaptor.forClass(ApiKeyEntry.class);
        verify(apiKeyRepository).save(captor.capture());

        ApiKeyEntry saved = captor.getValue();
        assertThat(saved.getUserId()).isEqualTo(userId);
        assertThat(saved.getKeyName()).isEqualTo("POLYGON_API_KEY");
        assertThat(saved.getEncryptedValue()).isNotBlank();
        assertThat(saved.getIv()).isNotBlank();
        // Ensure stored value is NOT plaintext
        assertThat(saved.getEncryptedValue()).isNotEqualTo("pk_test_12345678");
    }

    @Test
    void saveKey_existingKey_updatesInPlace() {
        ApiKeyEntry existing = ApiKeyEntry.builder()
                .id(UUID.randomUUID())
                .userId(userId)
                .keyName("POLYGON_API_KEY")
                .encryptedValue("old-cipher")
                .iv("old-iv")
                .build();

        when(apiKeyRepository.findByUserIdAndKeyName(userId, "POLYGON_API_KEY"))
                .thenReturn(Optional.of(existing));
        when(apiKeyRepository.save(any(ApiKeyEntry.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        apiKeyService.saveKey(userId, "POLYGON_API_KEY", "pk_new_value_5678");

        verify(apiKeyRepository).save(existing);
        assertThat(existing.getEncryptedValue()).isNotEqualTo("old-cipher");
        assertThat(existing.getIv()).isNotEqualTo("old-iv");
    }

    @Test
    void saveKey_thenGetDecryptedKey_roundtrip() {
        String plainValue = "sk-or-v1-roundtrip-test-value";

        when(apiKeyRepository.findByUserIdAndKeyName(userId, "OPENROUTER_API_KEY"))
                .thenReturn(Optional.empty());
        when(apiKeyRepository.save(any(ApiKeyEntry.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        apiKeyService.saveKey(userId, "OPENROUTER_API_KEY", plainValue);

        // Capture the saved entry to return it on get
        ArgumentCaptor<ApiKeyEntry> captor = ArgumentCaptor.forClass(ApiKeyEntry.class);
        verify(apiKeyRepository).save(captor.capture());
        ApiKeyEntry saved = captor.getValue();

        when(apiKeyRepository.findByUserIdAndKeyName(userId, "OPENROUTER_API_KEY"))
                .thenReturn(Optional.of(saved));

        Optional<String> decrypted = apiKeyService.getDecryptedKey(userId, "OPENROUTER_API_KEY");
        assertThat(decrypted).isPresent().contains(plainValue);
    }

    @Test
    void getDecryptedKey_notFound_returnsEmpty() {
        when(apiKeyRepository.findByUserIdAndKeyName(userId, "POLYGON_API_KEY"))
                .thenReturn(Optional.empty());

        Optional<String> result = apiKeyService.getDecryptedKey(userId, "POLYGON_API_KEY");
        assertThat(result).isEmpty();
    }

    @Test
    void deleteKey_delegatesToRepository() {
        apiKeyService.deleteKey(userId, "POLYGON_API_KEY");
        verify(apiKeyRepository).deleteByUserIdAndKeyName(userId, "POLYGON_API_KEY");
    }

    @Test
    void listKeyStatuses_returnsAllKnownKeys() {
        when(apiKeyRepository.findByUserId(userId)).thenReturn(List.of());

        List<ApiKeyStatusResponse> statuses = apiKeyService.listKeyStatuses(userId);

        assertThat(statuses).hasSize(KnownKey.values().length);

        // All should be not configured
        assertThat(statuses).allMatch(s -> !s.configured());
        assertThat(statuses).allMatch(s -> s.maskedPreview() == null);

        // Verify known key names are all present
        Set<String> names = new HashSet<>();
        for (ApiKeyStatusResponse s : statuses) {
            names.add(s.name());
        }
        for (KnownKey k : KnownKey.values()) {
            assertThat(names).contains(k.name());
        }
    }

    @Test
    void listKeyStatuses_withConfiguredKey_showsMaskedPreview() {
        String plainValue = "pk_test_my_api_key_abcd";
        EncryptedPayload payload = AesEncryptionUtil.encrypt(plainValue, testKey);

        ApiKeyEntry entry = ApiKeyEntry.builder()
                .userId(userId)
                .keyName("POLYGON_API_KEY")
                .encryptedValue(payload.ciphertext())
                .iv(payload.iv())
                .build();

        when(apiKeyRepository.findByUserId(userId)).thenReturn(List.of(entry));

        List<ApiKeyStatusResponse> statuses = apiKeyService.listKeyStatuses(userId);

        ApiKeyStatusResponse polygonStatus = statuses.stream()
                .filter(s -> "POLYGON_API_KEY".equals(s.name()))
                .findFirst()
                .orElseThrow();

        assertThat(polygonStatus.configured()).isTrue();
        assertThat(polygonStatus.maskedPreview()).isEqualTo("****abcd");
        assertThat(polygonStatus.label()).isEqualTo("Polygon.io API Key");
        assertThat(polygonStatus.category()).isEqualTo("market-data");
    }

    @Test
    void getEffectiveKey_prefersDbOverEnvFallback() {
        String dbValue = "db-api-key-value";
        EncryptedPayload payload = AesEncryptionUtil.encrypt(dbValue, testKey);

        ApiKeyEntry entry = ApiKeyEntry.builder()
                .userId(userId)
                .keyName("POLYGON_API_KEY")
                .encryptedValue(payload.ciphertext())
                .iv(payload.iv())
                .build();

        when(apiKeyRepository.findByUserIdAndKeyName(userId, "POLYGON_API_KEY"))
                .thenReturn(Optional.of(entry));

        String effective = apiKeyService.getEffectiveKey(userId, "POLYGON_API_KEY", "env-fallback-value");
        assertThat(effective).isEqualTo(dbValue);
    }

    @Test
    void getEffectiveKey_fallsBackToEnvWhenNoDbKey() {
        when(apiKeyRepository.findByUserIdAndKeyName(userId, "POLYGON_API_KEY"))
                .thenReturn(Optional.empty());

        String effective = apiKeyService.getEffectiveKey(userId, "POLYGON_API_KEY", "env-fallback-value");
        assertThat(effective).isEqualTo("env-fallback-value");
    }

    @Test
    void getEffectiveKey_returnsEmptyStringWhenNullFallback() {
        when(apiKeyRepository.findByUserIdAndKeyName(userId, "POLYGON_API_KEY"))
                .thenReturn(Optional.empty());

        String effective = apiKeyService.getEffectiveKey(userId, "POLYGON_API_KEY", null);
        assertThat(effective).isEmpty();
    }

    @Test
    void maskValue_showsLast4Chars() {
        assertThat(ApiKeyService.maskValue("my-secret-key-abcd")).isEqualTo("****abcd");
    }

    @Test
    void maskValue_shortValue_returnsAllStars() {
        assertThat(ApiKeyService.maskValue("abc")).isEqualTo("****");
        assertThat(ApiKeyService.maskValue("abcd")).isEqualTo("****");
    }

    @Test
    void maskValue_nullValue_returnsAllStars() {
        assertThat(ApiKeyService.maskValue(null)).isEqualTo("****");
    }

    @Test
    void knownKey_categoriesAreValid() {
        Set<String> validCategories = Set.of("market-data", "ai", "trading", "news");
        for (KnownKey key : KnownKey.values()) {
            assertThat(validCategories).contains(key.getCategory());
        }
    }

    @Test
    void knownKey_labelsAreNotBlank() {
        for (KnownKey key : KnownKey.values()) {
            assertThat(key.getLabel()).isNotBlank();
        }
    }
}
