package com.example.finsentinel.service.market;

import com.example.finsentinel.service.openbb.OpenbbPublicDataService;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class MarketCalendarService {

    private final OpenbbPublicDataService openbbService;

    public String getUpcomingEarnings(String ticker) {
        return queryAndFormat("equity/calendar/earnings",
                Map.of("symbol", ticker.toUpperCase().trim()),
                "Upcoming Earnings for " + ticker.toUpperCase().trim());
    }

    public String getDividendHistory(String ticker) {
        return queryAndFormat("equity/calendar/dividend",
                Map.of("symbol", ticker.toUpperCase().trim()),
                "Dividend Calendar for " + ticker.toUpperCase().trim());
    }

    public String getSplitHistory(String ticker) {
        return queryAndFormat("equity/fundamental/historical_splits",
                Map.of("symbol", ticker.toUpperCase().trim()),
                "Stock Split History for " + ticker.toUpperCase().trim());
    }

    public String getIPOCalendar() {
        return queryAndFormat("equity/calendar/ipo", Map.of(), "Upcoming IPO Calendar");
    }

    private String queryAndFormat(String path, Map<String, String> params, String title) {
        try {
            JsonNode result = openbbService.queryPublicData(path, null, new LinkedHashMap<>(params));
            if (result == null || result.isEmpty()) {
                return title + "\nNo data available.";
            }
            StringBuilder sb = new StringBuilder();
            sb.append("=== ").append(title).append(" ===\n");
            if (result.isArray()) {
                int count = 0;
                for (JsonNode item : result) {
                    if (count >= 20) {
                        sb.append("... and ").append(result.size() - 20).append(" more entries\n");
                        break;
                    }
                    sb.append(item.toString()).append("\n");
                    count++;
                }
                sb.append("Total: ").append(result.size()).append(" entries\n");
            } else {
                sb.append(result.toPrettyString()).append("\n");
            }
            return sb.toString();
        } catch (Exception e) {
            log.warn("Calendar query failed for {}: {}", path, e.getMessage());
            return title + "\nData unavailable: " + e.getMessage();
        }
    }
}
