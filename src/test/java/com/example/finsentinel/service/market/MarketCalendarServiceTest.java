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
class MarketCalendarServiceTest {

    @Mock private OpenbbPublicDataService openbbService;
    @InjectMocks private MarketCalendarService calendarService;
    private static final ObjectMapper mapper = JsonMapper.builder().build();

    @Test
    void getUpcomingEarnings_returnsFormattedResult() throws Exception {
        JsonNode mockData = mapper.readTree("[{\"date\":\"2026-03-01\",\"eps_estimate\":2.5}]");
        when(openbbService.queryPublicData(eq("equity/calendar/earnings"), isNull(), anyMap()))
                .thenReturn(mockData);
        String result = calendarService.getUpcomingEarnings("AAPL");
        assertThat(result).contains("Upcoming Earnings").contains("Total: 1 entries");
    }

    @Test
    void getUpcomingEarnings_handlesException() {
        when(openbbService.queryPublicData(anyString(), any(), anyMap()))
                .thenThrow(new IllegalArgumentException("OpenBB disabled"));
        String result = calendarService.getUpcomingEarnings("AAPL");
        assertThat(result).contains("Data unavailable");
    }

    @Test
    void getDividendHistory_returnsFormattedResult() throws Exception {
        JsonNode mockData = mapper.readTree("[{\"ex_date\":\"2026-02-10\",\"amount\":0.25}]");
        when(openbbService.queryPublicData(eq("equity/calendar/dividend"), isNull(), anyMap()))
                .thenReturn(mockData);
        String result = calendarService.getDividendHistory("MSFT");
        assertThat(result).contains("Dividend Calendar");
    }

    @Test
    void getIPOCalendar_emptyArray_returnsNoData() throws Exception {
        JsonNode mockData = mapper.readTree("[]");
        when(openbbService.queryPublicData(eq("equity/calendar/ipo"), isNull(), anyMap()))
                .thenReturn(mockData);
        String result = calendarService.getIPOCalendar();
        assertThat(result).contains("IPO Calendar").contains("No data available");
    }

    @Test
    void getIPOCalendar_withData_returnsFormattedResult() throws Exception {
        JsonNode mockData = mapper.readTree("[{\"company\":\"Acme Corp\",\"date\":\"2026-04-01\"}]");
        when(openbbService.queryPublicData(eq("equity/calendar/ipo"), isNull(), anyMap()))
                .thenReturn(mockData);
        String result = calendarService.getIPOCalendar();
        assertThat(result).contains("IPO Calendar").contains("Total: 1 entries");
    }
}
