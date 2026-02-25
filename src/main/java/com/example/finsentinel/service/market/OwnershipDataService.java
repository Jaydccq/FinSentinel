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
public class OwnershipDataService {

    private final OpenbbPublicDataService openbbService;

    public String getInstitutionalHolders(String ticker) {
        return queryAndFormat("equity/ownership/institutional",
                Map.of("symbol", ticker.toUpperCase().trim()),
                "Institutional Holders for " + ticker.toUpperCase().trim());
    }

    public String getInsiderTransactions(String ticker) {
        return queryAndFormat("equity/ownership/insider_trading",
                Map.of("symbol", ticker.toUpperCase().trim()),
                "Insider Transactions for " + ticker.toUpperCase().trim());
    }

    private String queryAndFormat(String path, Map<String, String> params, String title) {
        try {
            JsonNode result = openbbService.queryPublicData(path, "sec", new LinkedHashMap<>(params));
            if (result == null || result.isEmpty()) {
                return title + "\nNo data available.";
            }
            StringBuilder sb = new StringBuilder();
            sb.append("=== ").append(title).append(" ===\n");
            if (result.isArray()) {
                int count = 0;
                for (JsonNode item : result) {
                    if (count >= 25) {
                        sb.append("... and ").append(result.size() - 25).append(" more entries\n");
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
            log.warn("Ownership query failed for {}: {}", path, e.getMessage());
            return title + "\nData unavailable: " + e.getMessage();
        }
    }
}
