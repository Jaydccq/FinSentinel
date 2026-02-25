package com.example.finsentinel.service.market;

import com.example.finsentinel.service.openbb.OpenbbPublicDataService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ShortInterestServiceTest {

    @Mock private OpenbbPublicDataService openbbService;
    @InjectMocks private ShortInterestService shortInterestService;
    private static final ObjectMapper mapper = JsonMapper.builder().build();

    @Test
    void getShortInterest_returnsFormattedResult() throws Exception {
        JsonNode mockData = mapper.readTree("[{\"date\":\"2026-02-14\",\"short_volume\":5000000}]");
        when(openbbService.queryPublicData(eq("equity/shorts/short_interest"), isNull(), anyMap()))
                .thenReturn(mockData);
        String result = shortInterestService.getShortInterest("GME");
        assertThat(result).contains("Short Interest").contains("bi-weekly");
    }

    @Test
    void getFailsToDeliver_returnsFormattedResult() throws Exception {
        JsonNode mockData = mapper.readTree("[{\"date\":\"2026-01-15\",\"quantity\":100000}]");
        when(openbbService.queryPublicData(eq("equity/shorts/fails_to_deliver"), isNull(), anyMap()))
                .thenReturn(mockData);
        String result = shortInterestService.getFailsToDeliver("AMC");
        assertThat(result).contains("Fails to Deliver").contains("SEC");
    }

    @Test
    void getShortInterest_handlesException() {
        when(openbbService.queryPublicData(anyString(), any(), anyMap()))
                .thenThrow(new IllegalArgumentException("OpenBB disabled"));
        String result = shortInterestService.getShortInterest("GME");
        assertThat(result).contains("Data unavailable");
    }
}
