package com.example.finsentinel.controller;

import com.example.finsentinel.service.openbb.OpenbbBusinessDataService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OpenbbBusinessDataControllerTest {

    @Mock
    private OpenbbBusinessDataService openbbBusinessDataService;

    private OpenbbBusinessDataController controller;
    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    @BeforeEach
    void setUp() {
        controller = new OpenbbBusinessDataController(openbbBusinessDataService);
    }

    @Test
    void usCpi_shouldReturnPayload() throws Exception {
        JsonNode payload = objectMapper.readTree("{\"series\":\"CPIAUCSL\"}");
        when(openbbBusinessDataService.getUsCpi("2020-01-01", "2020-12-31", 12)).thenReturn(payload);

        ResponseEntity<JsonNode> response = controller.usCpi("2020-01-01", "2020-12-31", 12);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEqualTo(payload);
    }

    @Test
    void usUnemployment_shouldDelegateToService() throws Exception {
        JsonNode payload = objectMapper.readTree("{\"series\":\"UNRATE\"}");
        when(openbbBusinessDataService.getUsUnemploymentRate(null, null, 24)).thenReturn(payload);

        ResponseEntity<JsonNode> response = controller.usUnemployment(null, null, 24);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        verify(openbbBusinessDataService).getUsUnemploymentRate(null, null, 24);
    }

    @Test
    void usFedFundsRate_shouldDelegateToService() throws Exception {
        JsonNode payload = objectMapper.readTree("{\"series\":\"FEDFUNDS\"}");
        when(openbbBusinessDataService.getUsFedFundsRate("2021-01-01", null, null)).thenReturn(payload);

        ResponseEntity<JsonNode> response = controller.usFedFundsRate("2021-01-01", null, null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        verify(openbbBusinessDataService).getUsFedFundsRate("2021-01-01", null, null);
    }
}
