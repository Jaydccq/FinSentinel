package com.example.finsentinel.service.research;

import com.example.finsentinel.config.ResearchProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Registry that discovers and indexes all {@link ResearchDataProvider} beans.
 *
 * <p>Providers are auto-wired via Spring's {@code List<ResearchDataProvider>}
 * injection and indexed by their {@link ResearchDataProvider#getName() name} for
 * O(1) lookup. The active default provider is controlled by the
 * {@code app.research.default-provider} configuration property.
 *
 * <p>This design allows new providers (yfinance, FMP, etc.) to be added as
 * Spring beans without any registry or service modification.
 */
@Component
@Slf4j
public class ResearchDataProviderRegistry {

    private final Map<String, ResearchDataProvider> providers;
    private final ResearchProperties researchProperties;

    /**
     * Constructs the registry from all discovered provider beans.
     *
     * @param providerList       all {@link ResearchDataProvider} beans in the context
     * @param researchProperties configuration controlling the default provider
     */
    public ResearchDataProviderRegistry(List<ResearchDataProvider> providerList,
                                         ResearchProperties researchProperties) {
        this.researchProperties = researchProperties;
        this.providers = providerList.stream()
                .collect(Collectors.toMap(
                        ResearchDataProvider::getName,
                        Function.identity()
                ));
        log.info("Registered {} research data provider(s): {}", providers.size(), providers.keySet());
    }

    /**
     * Looks up a provider by its unique name.
     *
     * @param name provider name (e.g. "polygon")
     * @return the matching provider
     * @throws IllegalArgumentException if no provider is registered with the given name
     */
    public ResearchDataProvider getProvider(String name) {
        ResearchDataProvider provider = providers.get(name);
        if (provider == null) {
            throw new IllegalArgumentException(
                    "No research provider registered with name: " + name
                            + ". Available: " + providers.keySet());
        }
        return provider;
    }

    /**
     * Returns the default provider as configured by {@code app.research.default-provider}.
     *
     * <p>Falls back to the first available provider if the configured name is not found,
     * logging a warning in that case.
     *
     * @return the default research data provider
     * @throws IllegalStateException if no providers are registered at all
     */
    public ResearchDataProvider getDefaultProvider() {
        String defaultName = researchProperties.getDefaultProvider();
        ResearchDataProvider provider = providers.get(defaultName);
        if (provider != null) {
            return provider;
        }

        if (providers.isEmpty()) {
            throw new IllegalStateException("No research providers registered");
        }

        ResearchDataProvider fallback = providers.values().iterator().next();
        log.warn("Configured research provider '{}' not found; falling back to '{}'",
                defaultName, fallback.getName());
        return fallback;
    }

    /**
     * Returns the names of all registered providers (for diagnostics and health checks).
     *
     * @return unmodifiable set of provider names
     */
    public Set<String> getRegisteredProviderNames() {
        return Collections.unmodifiableSet(providers.keySet());
    }
}
