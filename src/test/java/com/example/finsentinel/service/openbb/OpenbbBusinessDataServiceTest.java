package com.example.finsentinel.service.openbb;

import com.example.finsentinel.config.OpenbbProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OpenbbBusinessDataServiceTest {

    private OpenbbPublicDataService publicDataService;
    private OpenbbBusinessDataService businessDataService;
    private OpenbbProperties properties;

    @BeforeEach
    void setUp() {
        publicDataService = mock(OpenbbPublicDataService.class);
        properties = new OpenbbProperties();
        properties.getBusiness().setMacroProvider("fred");
        properties.getBusiness().setCpiPath("economy/cpi");
        properties.getBusiness().setUnemploymentPath("economy/unemployment");
        properties.getBusiness().setFedFundsPath("economy/federal_funds_rate");
        properties.getBusiness().setCpiSeriesId("CPIAUCSL");
        properties.getBusiness().setUnemploymentSeriesId("UNRATE");
        properties.getBusiness().setFedFundsSeriesId("FEDFUNDS");
        businessDataService = new OpenbbBusinessDataService(publicDataService, properties);
    }

    @Test
    void getUsCpi_shouldCallPublicDataServiceWithDefaultSeries() throws Exception {
        ObjectMapper objectMapper = JsonMapper.builder().build();
        when(publicDataService.queryPublicData(
                eq("economy/cpi"),
                eq("fred"),
                eq(Map.of("series_id", "CPIAUCSL", "limit", "12"))))
                .thenReturn(objectMapper.readTree("{\"ok\":true}"));

        var result = businessDataService.getUsCpi(null, null, 12);

        assertThat(result.path("ok").asBoolean()).isTrue();
        verify(publicDataService).queryPublicData(
                "economy/cpi",
                "fred",
                Map.of("series_id", "CPIAUCSL", "limit", "12")
        );
    }

    @Test
    void getUsUnemploymentRate_shouldPassDateRange() {
        businessDataService.getUsUnemploymentRate("2020-01-01", "2021-01-01", null);

        verify(publicDataService).queryPublicData(
                "economy/unemployment",
                "fred",
                Map.of(
                        "series_id", "UNRATE",
                        "start_date", "2020-01-01",
                        "end_date", "2021-01-01"
                )
        );
    }
}
