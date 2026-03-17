package com.example.finsentinel.controller;

import com.example.finsentinel.dto.apikey.ApiKeySaveRequest;
import com.example.finsentinel.dto.apikey.ApiKeyStatusResponse;
import com.example.finsentinel.security.UserPrincipal;
import com.example.finsentinel.service.ApiKeyService;
import com.example.finsentinel.service.ApiKeyService.KnownKey;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;

/**
 * REST controller for managing encrypted API key storage.
 *
 * <p>Exposes endpoints for listing, saving, deleting, and testing API keys.
 * All endpoints require JWT authentication, and keys are scoped to the
 * authenticated user.
 *
 * <p>This class belongs to the controller layer in FinSentinel.
 */
@RestController
@RequestMapping("/api/settings/api-keys")
@RequiredArgsConstructor
@Slf4j
public class ApiKeyController {

    private final ApiKeyService apiKeyService;
    private final RestClient restClient;

    /**
     * Lists the configuration status of all known API keys for the authenticated user.
     *
     * @param principal the authenticated user
     * @return list of key statuses with masked previews
     */
    @GetMapping
    public ResponseEntity<List<ApiKeyStatusResponse>> listKeyStatuses(
            @AuthenticationPrincipal UserPrincipal principal) {
        return ResponseEntity.ok(apiKeyService.listKeyStatuses(principal.getUserId()));
    }

    /**
     * Saves (or updates) an API key for the authenticated user.
     *
     * @param name      the key name (must match a known key identifier)
     * @param request   the save request containing the plaintext value
     * @param principal the authenticated user
     * @return 200 OK with confirmation
     */
    @PutMapping("/{name}")
    public ResponseEntity<Map<String, String>> saveKey(
            @PathVariable String name,
            @Valid @RequestBody ApiKeySaveRequest request,
            @AuthenticationPrincipal UserPrincipal principal) {

        validateKeyName(name);
        apiKeyService.saveKey(principal.getUserId(), name, request.value());
        return ResponseEntity.ok(Map.of("message", "API key saved successfully"));
    }

    /**
     * Deletes a stored API key for the authenticated user.
     *
     * @param name      the key name
     * @param principal the authenticated user
     * @return 204 No Content
     */
    @DeleteMapping("/{name}")
    public ResponseEntity<Void> deleteKey(
            @PathVariable String name,
            @AuthenticationPrincipal UserPrincipal principal) {

        validateKeyName(name);
        apiKeyService.deleteKey(principal.getUserId(), name);
        return ResponseEntity.noContent().build();
    }

    /**
     * Tests connectivity for a stored API key by pinging the provider.
     *
     * <p>Currently supports Polygon.io and OpenRouter. Other providers return
     * a generic "test not available" response.
     *
     * @param name      the key name
     * @param principal the authenticated user
     * @return test result with success/failure status
     */
    @PostMapping("/{name}/test")
    public ResponseEntity<Map<String, Object>> testKey(
            @PathVariable String name,
            @AuthenticationPrincipal UserPrincipal principal) {

        validateKeyName(name);

        return apiKeyService.getDecryptedKey(principal.getUserId(), name)
                .map(key -> {
                    Map<String, Object> result = switch (name) {
                        case "POLYGON_API_KEY" -> testPolygonKey(key);
                        case "OPENROUTER_API_KEY" -> testOpenRouterKey(key);
                        default -> Map.of(
                                "success", (Object) false,
                                "message", "Test not available for this provider"
                        );
                    };
                    return ResponseEntity.ok(result);
                })
                .orElseGet(() -> ResponseEntity.ok(Map.of(
                        "success", false,
                        "message", "Key not configured"
                )));
    }

    private Map<String, Object> testPolygonKey(String apiKey) {
        try {
            restClient.get()
                    .uri("https://api.polygon.io/v3/reference/tickers/AAPL?apiKey={key}", apiKey)
                    .retrieve()
                    .body(String.class);
            return Map.of("success", true, "message", "Polygon.io connection successful");
        } catch (Exception e) {
            log.debug("Polygon API key test failed: {}", e.getMessage());
            return Map.of("success", false, "message", "Polygon.io connection failed: " + e.getMessage());
        }
    }

    private Map<String, Object> testOpenRouterKey(String apiKey) {
        try {
            restClient.get()
                    .uri("https://openrouter.ai/api/v1/models")
                    .header("Authorization", "Bearer " + apiKey)
                    .retrieve()
                    .body(String.class);
            return Map.of("success", true, "message", "OpenRouter connection successful");
        } catch (Exception e) {
            log.debug("OpenRouter API key test failed: {}", e.getMessage());
            return Map.of("success", false, "message", "OpenRouter connection failed: " + e.getMessage());
        }
    }

    private void validateKeyName(String name) {
        try {
            KnownKey.valueOf(name);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Unknown API key name: " + name);
        }
    }
}
