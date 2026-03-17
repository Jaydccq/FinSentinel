package com.example.finsentinel.service.research;

import com.example.finsentinel.config.ResearchProperties;
import com.example.finsentinel.dto.research.CompanyProfile;
import com.example.finsentinel.dto.research.FinancialMetrics;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

class ResearchDataProviderRegistryTest {

    @Test
    void getDefaultProvider_returnsConfiguredProvider() {
        ResearchDataProvider mockProvider = new ResearchDataProvider() {
            @Override public String getName() { return "test"; }
            @Override public CompanyProfile getCompanyProfile(String ticker) { return null; }
            @Override public List<FinancialMetrics> getFinancialMetrics(String ticker, int periods) { return List.of(); }
        };

        ResearchProperties props = new ResearchProperties();
        props.setDefaultProvider("test");

        ResearchDataProviderRegistry registry = new ResearchDataProviderRegistry(List.of(mockProvider), props);
        assertThat(registry.getDefaultProvider().getName()).isEqualTo("test");
    }

    @Test
    void getDefaultProvider_fallsBackWhenConfiguredNotFound() {
        ResearchDataProvider mockProvider = new ResearchDataProvider() {
            @Override public String getName() { return "fallback"; }
            @Override public CompanyProfile getCompanyProfile(String ticker) { return null; }
            @Override public List<FinancialMetrics> getFinancialMetrics(String ticker, int periods) { return List.of(); }
        };

        ResearchProperties props = new ResearchProperties();
        props.setDefaultProvider("nonexistent");

        ResearchDataProviderRegistry registry = new ResearchDataProviderRegistry(List.of(mockProvider), props);
        assertThat(registry.getDefaultProvider().getName()).isEqualTo("fallback");
    }

    @Test
    void getProvider_returnsNamedProvider() {
        ResearchDataProvider provider = new ResearchDataProvider() {
            @Override public String getName() { return "polygon"; }
            @Override public CompanyProfile getCompanyProfile(String ticker) { return null; }
            @Override public List<FinancialMetrics> getFinancialMetrics(String ticker, int periods) { return List.of(); }
        };

        ResearchProperties props = new ResearchProperties();
        ResearchDataProviderRegistry registry = new ResearchDataProviderRegistry(List.of(provider), props);

        assertThat(registry.getProvider("polygon").getName()).isEqualTo("polygon");
    }

    @Test
    void getProvider_throwsForUnknownName() {
        ResearchProperties props = new ResearchProperties();
        ResearchDataProviderRegistry registry = new ResearchDataProviderRegistry(List.of(), props);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> registry.getProvider("unknown"))
                .withMessageContaining("No research provider registered with name: unknown");
    }

    @Test
    void getDefaultProvider_throwsWhenNoProvidersRegistered() {
        ResearchProperties props = new ResearchProperties();
        props.setDefaultProvider("nonexistent");

        ResearchDataProviderRegistry registry = new ResearchDataProviderRegistry(List.of(), props);

        assertThatIllegalStateException()
                .isThrownBy(registry::getDefaultProvider)
                .withMessageContaining("No research providers registered");
    }

    @Test
    void getRegisteredProviderNames_returnsAllNames() {
        ResearchDataProvider p1 = new ResearchDataProvider() {
            @Override public String getName() { return "alpha"; }
            @Override public CompanyProfile getCompanyProfile(String ticker) { return null; }
            @Override public List<FinancialMetrics> getFinancialMetrics(String ticker, int periods) { return List.of(); }
        };
        ResearchDataProvider p2 = new ResearchDataProvider() {
            @Override public String getName() { return "beta"; }
            @Override public CompanyProfile getCompanyProfile(String ticker) { return null; }
            @Override public List<FinancialMetrics> getFinancialMetrics(String ticker, int periods) { return List.of(); }
        };

        ResearchProperties props = new ResearchProperties();
        ResearchDataProviderRegistry registry = new ResearchDataProviderRegistry(List.of(p1, p2), props);

        assertThat(registry.getRegisteredProviderNames()).containsExactlyInAnyOrder("alpha", "beta");
    }
}
