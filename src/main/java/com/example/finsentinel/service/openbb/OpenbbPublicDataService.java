package com.example.finsentinel.service.openbb;

import com.example.finsentinel.config.OpenbbProperties;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;
import org.springframework.util.StringUtils;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class OpenbbPublicDataService {

    private final RestClient restClient;
    private final OpenbbProperties openbbProperties;

    public JsonNode queryPublicData(String path, String provider, Map<String, String> queryParams) {
        if (!openbbProperties.isEnabled()) {
            throw new IllegalArgumentException("OpenBB integration is disabled. Set APP_OPENBB_ENABLED=true first.");
        }
        String normalizedPath = normalizePath(path);
        String normalizedProvider = normalizeProvider(provider);
        URI uri = buildUri(normalizedPath, normalizedProvider, queryParams);

        try {
            RestClient.RequestHeadersSpec<?> request = restClient.get()
                    .uri(uri)
                    .accept(MediaType.APPLICATION_JSON);

            String openbbApiKey = openbbProperties.getApiKey();
            if (StringUtils.hasText(openbbApiKey)) {
                request = request.header("Authorization", "Bearer " + openbbApiKey)
                        .header("X-API-Key", openbbApiKey);
            }

            JsonNode body = request.retrieve().body(JsonNode.class);
            if (body == null) {
                throw new IllegalArgumentException("OpenBB returned an empty response.");
            }
            return body;
        } catch (RestClientResponseException ex) {
            log.warn("OpenBB request failed for path={} provider={} status={}: {}",
                    normalizedPath, normalizedProvider, ex.getStatusCode().value(),
                    ex.getResponseBodyAsString());
            throw new IllegalArgumentException(
                    "OpenBB request failed (HTTP " + ex.getStatusCode().value()
                    + "). Check the path and provider, then try again.");
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception ex) {
            log.error("OpenBB request error for path={} provider={}", normalizedPath, normalizedProvider, ex);
            throw new IllegalArgumentException("Failed to call OpenBB: " + ex.getMessage());
        }
    }

    public Map<String, Object> getPublicConnectorStatus() {
        OpenbbProperties.Credentials credentials = openbbProperties.getCredentials();
        List<Map<String, Object>> connectors = List.of(
                connector("openbb-bls", "bls", "Bureau of Labor Statistics", "bls_api_key",
                        StringUtils.hasText(credentials.getBlsApiKey()), true),
                connector("openbb-congress-gov", "congress_gov", "US Congress", "congress_gov_api_key",
                        StringUtils.hasText(credentials.getCongressGovApiKey()), true),
                connector("openbb-cftc", "cftc", "Commodity Futures Trading Commission", "cftc_app_token",
                        StringUtils.hasText(credentials.getCftcAppToken()), true),
                connector("openbb-ecb", "ecb", "European Central Bank", null, true, true),
                connector("openbb-imf", "imf", "International Monetary Fund", null, true, true),
                connector("openbb-federal-reserve", "federal_reserve", "Federal Reserve", null, true, true),
                connector("openbb-fred", "fred", "FRED", "fred_api_key",
                        StringUtils.hasText(credentials.getFredApiKey()), true),
                connector("openbb-government-us", "government_us", "US Government datasets", null, true, true),
                connector("openbb-oecd", "oecd", "OECD", null, true, true),
                connector("openbb-polygon", "polygon", "Polygon", "polygon_api_key",
                        StringUtils.hasText(credentials.getPolygonApiKey()), true),
                connector("openbb-sec", "sec", "SEC", null, true, true),
                connector("openbb-us-eia", "us_eia", "US EIA", null, true, true)
        );

        return Map.of(
                "enabled", openbbProperties.isEnabled(),
                "baseUrl", openbbProperties.getBaseUrl(),
                "apiPrefix", openbbProperties.getApiPrefix(),
                "connectors", connectors
        );
    }

    private URI buildUri(String path, String provider, Map<String, String> queryParams) {
        String baseUrl = removeTrailingSlash(openbbProperties.getBaseUrl());
        String prefix = normalizePrefix(openbbProperties.getApiPrefix());
        String fullPath = baseUrl + prefix + "/" + path;

        UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(fullPath);
        if (StringUtils.hasText(provider)) {
            builder.queryParam("provider", provider);
            maybeAppendProviderCredential(builder, provider, queryParams);
        }
        if (queryParams != null) {
            queryParams.forEach((k, v) -> {
                if (StringUtils.hasText(k) && StringUtils.hasText(v)) {
                    builder.queryParam(k, v);
                }
            });
        }
        return builder.build().encode().toUri();
    }

    private void maybeAppendProviderCredential(UriComponentsBuilder builder,
                                               String provider,
                                               Map<String, String> queryParams) {
        OpenbbProperties.Credentials credentials = openbbProperties.getCredentials();
        Map<String, String> credentialByProvider = new LinkedHashMap<>();
        credentialByProvider.put("bls", credentials.getBlsApiKey());
        credentialByProvider.put("congress_gov", credentials.getCongressGovApiKey());
        credentialByProvider.put("cftc", credentials.getCftcAppToken());
        credentialByProvider.put("fred", credentials.getFredApiKey());
        credentialByProvider.put("polygon", credentials.getPolygonApiKey());

        Map<String, String> keyParamByProvider = new LinkedHashMap<>();
        keyParamByProvider.put("bls", "bls_api_key");
        keyParamByProvider.put("congress_gov", "congress_gov_api_key");
        keyParamByProvider.put("cftc", "cftc_app_token");
        keyParamByProvider.put("fred", "fred_api_key");
        keyParamByProvider.put("polygon", "polygon_api_key");

        String keyParam = keyParamByProvider.get(provider);
        String keyValue = credentialByProvider.get(provider);
        if (!StringUtils.hasText(keyParam) || !StringUtils.hasText(keyValue)) {
            return;
        }
        if (queryParams != null && StringUtils.hasText(queryParams.get(keyParam))) {
            return;
        }
        builder.queryParam(keyParam, keyValue);
    }

    private Map<String, Object> connector(String extensionName,
                                          String providerName,
                                          String description,
                                          String keyParam,
                                          boolean configured,
                                          boolean free) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("extension", extensionName);
        payload.put("provider", providerName);
        payload.put("description", description);
        payload.put("free", free);
        payload.put("apiKeyParam", keyParam);
        payload.put("configured", keyParam == null || configured);
        return payload;
    }

    private String normalizePath(String path) {
        if (!StringUtils.hasText(path)) {
            throw new IllegalArgumentException("Query path is required. Example: economy/cpi");
        }
        String normalized = path.trim().replaceAll("^/+", "");
        // Defense-in-depth: decode percent-encoded chars before safety checks
        try {
            normalized = java.net.URLDecoder.decode(normalized, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid query path encoding: " + path);
        }
        if (!StringUtils.hasText(normalized) || normalized.contains("..")) {
            throw new IllegalArgumentException("Invalid query path: " + path);
        }
        if (normalized.contains("?")) {
            throw new IllegalArgumentException("Path must not include query string. Pass query params separately.");
        }
        if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
            throw new IllegalArgumentException("Path must be relative, not a full URL.");
        }
        return normalized;
    }

    private String normalizeProvider(String provider) {
        if (!StringUtils.hasText(provider)) {
            return null;
        }
        return provider.trim().toLowerCase().replace('-', '_');
    }

    private String normalizePrefix(String prefix) {
        if (!StringUtils.hasText(prefix)) {
            return "";
        }
        String normalized = prefix.trim();
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        return removeTrailingSlash(normalized);
    }

    private String removeTrailingSlash(String value) {
        if (!StringUtils.hasText(value)) {
            return "";
        }
        String normalized = value.trim();
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }
}
