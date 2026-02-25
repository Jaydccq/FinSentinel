package com.example.finsentinel.service.autonomy;

import com.example.finsentinel.config.NewsProperties;
import com.example.finsentinel.model.AgentSchedule;
import com.example.finsentinel.model.enums.AgentScheduleTaskType;
import com.example.finsentinel.service.MarketDataService;
import com.example.finsentinel.service.trading.AgentBrainService;
import com.example.finsentinel.service.trading.PaperTradingService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Executes autonomous task payloads triggered by cron schedules.
 */
@Component
@RequiredArgsConstructor
public class AgentScheduledTaskExecutor {

    private final PaperTradingService paperTradingService;
    private final AgentBrainService agentBrainService;
    private final MarketDataService marketDataService;
    private final AgentHeartbeatService heartbeatService;
    private final NewsProperties newsProperties;

    public Map<String, Object> execute(AgentSchedule schedule) {
        AgentScheduleTaskType taskType = schedule.getTaskType();
        return switch (taskType) {
            case PORTFOLIO_REVIEW -> runPortfolioReview(schedule);
            case MARKET_PULSE -> runMarketPulse(schedule);
            case BRAIN_REVIEW -> runBrainReview(schedule);
            case HEARTBEAT_WAKEUP -> heartbeatService.runHeartbeatOnce(schedule.getUserId(), "schedule");
        };
    }

    private Map<String, Object> runPortfolioReview(AgentSchedule schedule) {
        String report = paperTradingService.getWalletStatus(schedule.getUserId());
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("task", "PORTFOLIO_REVIEW");
        payload.put("reportLength", report != null ? report.length() : 0);
        payload.put("preview", truncate(report, 280));
        return payload;
    }

    private Map<String, Object> runMarketPulse(AgentSchedule schedule) {
        List<String> tickers = extractTickers(schedule.getTaskPayload());
        Map<String, Object> quotes = marketDataService.getBatchQuotes(tickers);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("task", "MARKET_PULSE");
        payload.put("tickers", tickers);
        payload.put("quoteCount", quotes != null ? quotes.size() : 0);
        return payload;
    }

    private Map<String, Object> runBrainReview(AgentSchedule schedule) {
        String emotion = agentBrainService.getEmotion(schedule.getUserId());
        String strategy = agentBrainService.getFrontalLobe(schedule.getUserId());
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("task", "BRAIN_REVIEW");
        payload.put("emotion", emotion);
        payload.put("strategyLength", strategy != null ? strategy.length() : 0);
        payload.put("strategyPreview", truncate(strategy, 220));
        return payload;
    }

    private List<String> extractTickers(Map<String, Object> payload) {
        Object value = payload != null ? payload.get("tickers") : null;
        if (value instanceof List<?> list && !list.isEmpty()) {
            List<String> resolved = list.stream()
                    .filter(v -> v != null && !v.toString().isBlank())
                    .map(v -> v.toString().toUpperCase().trim())
                    .distinct()
                    .limit(20)
                    .collect(Collectors.toList());
            if (!resolved.isEmpty()) {
                return resolved;
            }
        }
        return newsProperties.getWatchTickers().stream().limit(8).toList();
    }

    private String truncate(String text, int max) {
        if (text == null) return "";
        return text.length() <= max ? text : text.substring(0, max) + "...";
    }
}
