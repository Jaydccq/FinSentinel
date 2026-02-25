package com.example.finsentinel.controller;

import com.example.finsentinel.service.openbb.OpenbbPublicDataService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OpenbbPublicDataControllerTest {

    @Mock
    private OpenbbPublicDataService openbbPublicDataService;

    private OpenbbPublicDataController controller;
    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    @BeforeEach
    void setUp() {
        controller = new OpenbbPublicDataController(openbbPublicDataService);
    }

    @Test
    void providers_shouldReturnConnectorStatus() {
        when(openbbPublicDataService.getPublicConnectorStatus()).thenReturn(Map.of("enabled", true));

        ResponseEntity<Map<String, Object>> response = controller.providers();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).containsEntry("enabled", true);
    }

    @Test
    void query_shouldForwardPathProviderAndCustomParams() throws Exception {
        JsonNode payload = objectMapper.readTree("{\"ok\":true}");
        when(openbbPublicDataService.queryPublicData(
                "economy/cpi", "fred", Map.of("series_id", "CPIAUCSL")))
                .thenReturn(payload);

        ResponseEntity<JsonNode> response = controller.query(
                "economy/cpi",
                "fred",
                Map.of("path", "economy/cpi", "provider", "fred", "series_id", "CPIAUCSL"));

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEqualTo(payload);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> captor = ArgumentCaptor.forClass(Map.class);
        verify(openbbPublicDataService).queryPublicData(
                org.mockito.ArgumentMatchers.eq("economy/cpi"),
                org.mockito.ArgumentMatchers.eq("fred"),
                captor.capture());
        assertThat(captor.getValue())
                .containsEntry("series_id", "CPIAUCSL")
                .doesNotContainKeys("path", "provider");
    }
}
