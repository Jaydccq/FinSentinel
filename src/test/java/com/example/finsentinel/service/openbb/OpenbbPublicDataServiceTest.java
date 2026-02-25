package com.example.finsentinel.service.openbb;

import com.example.finsentinel.config.OpenbbProperties;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class OpenbbPublicDataServiceTest {

    @Test
    void queryPublicData_shouldRejectWhenDisabled() {
        OpenbbProperties properties = new OpenbbProperties();
        properties.setEnabled(false);
        OpenbbPublicDataService service = new OpenbbPublicDataService(mock(RestClient.class), properties);

        assertThatThrownBy(() -> service.queryPublicData("economy/cpi", "fred", Map.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("APP_OPENBB_ENABLED=true");
    }

    @Test
    void queryPublicData_shouldRejectUrlEncodedPathTraversal() {
        OpenbbProperties properties = new OpenbbProperties();
        properties.setEnabled(true);
        OpenbbPublicDataService service = new OpenbbPublicDataService(mock(RestClient.class), properties);

        assertThatThrownBy(() -> service.queryPublicData("%2e%2e/etc/passwd", "fred", Map.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid query path");
    }

    @Test
    void getPublicConnectorStatus_shouldReflectConfiguredCredentials() {
        OpenbbProperties properties = new OpenbbProperties();
        properties.setEnabled(true);
        properties.getCredentials().setFredApiKey("fred-key");
        OpenbbPublicDataService service = new OpenbbPublicDataService(mock(RestClient.class), properties);

        Map<String, Object> status = service.getPublicConnectorStatus();

        assertThat(status).containsEntry("enabled", true);
        assertThat(status).containsKey("connectors");
        @SuppressWarnings("unchecked")
        java.util.List<Map<String, Object>> connectors = (java.util.List<Map<String, Object>>) status.get("connectors");
        Map<String, Object> fred = connectors.stream()
                .filter(c -> "fred".equals(c.get("provider")))
                .findFirst()
                .orElseThrow();
        assertThat(fred).containsEntry("configured", true);
    }
}
