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
public class ShortInterestService {

    private final OpenbbPublicDataService openbbService;

    public String getShortInterest(String ticker) {
        return queryAndFormat("equity/shorts/short_interest",
                Map.of("symbol", ticker.toUpperCase().trim()),
                "Short Interest for " + ticker.toUpperCase().trim(),
                "Note: Short interest data is reported bi-weekly with ~2 week delay.");
    }

    public String getFailsToDeliver(String ticker) {
        return queryAndFormat("equity/shorts/fails_to_deliver",
                Map.of("symbol", ticker.toUpperCase().trim()),
                "Fails to Deliver for " + ticker.toUpperCase().trim(),
                "Note: FTD data is reported by SEC with ~1 month delay.");
    }

    private String queryAndFormat(String path, Map<String, String> params, String title, String caveat) {
        try {
            JsonNode result = openbbService.queryPublicData(path, null, new LinkedHashMap<>(params));
            if (result == null || result.isEmpty()) {
                return title + "\nNo data available. " + caveat;
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
            sb.append("\n").append(caveat);
            return sb.toString();
        } catch (Exception e) {
            log.warn("Short interest query failed for {}: {}", path, e.getMessage());
            return title + "\nData unavailable: " + e.getMessage();
        }
    }
}
