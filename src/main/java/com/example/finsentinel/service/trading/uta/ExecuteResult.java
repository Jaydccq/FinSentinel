package com.example.finsentinel.service.trading.uta;

import java.util.List;
import java.util.Map;

/**
 * Result of executing a trade commit — contains both the human-readable report
 * (for AI tool responses) and the structured data (for REST API responses).
 */
public record ExecuteResult(
        String report,
        Map<String, Object> commitData,
        List<Map<String, Object>> operationResults
) {}
