package com.example.finsentinel.service.market;

import com.example.finsentinel.config.MarketProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Registry that discovers and indexes all {@link MarketDataProvider} beans.
 *
 * <p>Providers are auto-wired via Spring's {@code List<MarketDataProvider>}
 * injection and indexed by their {@link MarketDataProvider#getName() name} for
 * O(1) lookup. The active default provider is controlled by the
 * {@code app.market.default-provider} configuration property.
 *
 * <p>This design allows new providers (Alpha Vantage, Yahoo Finance, etc.) to
 * be added as Spring beans without any registry or service modification.
 */
@Component
@Slf4j
public class MarketDataProviderRegistry {

    private final Map<String, MarketDataProvider> providers;
    private final MarketProperties marketProperties;

    /**
     * Constructs the registry from all discovered provider beans.
     *
     * @param providerList all {@link MarketDataProvider} beans in the context
     * @param marketProperties configuration controlling the default provider
     */
    public MarketDataProviderRegistry(List<MarketDataProvider> providerList,
                                      MarketProperties marketProperties) {
        this.marketProperties = marketProperties;
        this.providers = providerList.stream()
                .collect(Collectors.toMap(
                        MarketDataProvider::getName,
                        Function.identity()
                ));
        log.info("Registered {} market data provider(s): {}", providers.size(), providers.keySet());
    }

    /**
     * Looks up a provider by its unique name.
     *
     * @param name provider name (e.g. "polygon")
     * @return the matching provider
     * @throws IllegalArgumentException if no provider is registered with the given name
     */
    public MarketDataProvider getProvider(String name) {
        MarketDataProvider provider = providers.get(name);
        if (provider == null) {
            throw new IllegalArgumentException(
                    "No market data provider registered with name: " + name
                            + ". Available: " + providers.keySet());
        }
        return provider;
    }

    /**
     * Returns the default provider as configured by {@code app.market.default-provider}.
     *
     * <p>Falls back to the first available provider if the configured name is not found,
     * logging a warning in that case.
     *
     * @return the default market data provider
     * @throws IllegalStateException if no providers are registered at all
     */
    public MarketDataProvider getDefaultProvider() {
        String defaultName = marketProperties.getDefaultProvider();
        MarketDataProvider provider = providers.get(defaultName);
        if (provider != null) {
            return provider;
        }

        if (providers.isEmpty()) {
            throw new IllegalStateException("No market data providers registered");
        }

        MarketDataProvider fallback = providers.values().iterator().next();
        log.warn("Configured default provider '{}' not found; falling back to '{}'",
                defaultName, fallback.getName());
        return fallback;
    }

    /**
     * Returns the names of all registered providers (for diagnostics and health checks).
     *
     * @return unmodifiable set of provider names
     */
    public java.util.Set<String> getRegisteredProviderNames() {
        return java.util.Collections.unmodifiableSet(providers.keySet());
    }
}
