package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.autonomy.AgentHeartbeatService;
import com.example.finsentinel.service.autonomy.AgentScheduleService;
import com.example.finsentinel.util.SecurityUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * AI tools for autonomy management: cron tasks and heartbeat configuration.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AutonomyTool {

    private static final ObjectMapper OBJECT_MAPPER = JsonMapper.builder().build();

    private final AgentScheduleService scheduleService;
    private final AgentHeartbeatService heartbeatService;

    @Tool(description = "Create an autonomous cron task the AI can run on schedule. "
            + "Task types: PORTFOLIO_REVIEW, MARKET_PULSE, BRAIN_REVIEW, HEARTBEAT_WAKEUP. "
            + "Use cron format like '0 */2 * * * *' for every 2 hours.")
    public String createCronTask(
            @ToolParam(description = "Human-readable schedule name") String name,
            @ToolParam(description = "Cron expression with seconds, e.g. '0 0 9 * * MON-FRI'") String cronExpression,
            @ToolParam(description = "Task type: PORTFOLIO_REVIEW, MARKET_PULSE, BRAIN_REVIEW, HEARTBEAT_WAKEUP") String taskType,
            @ToolParam(description = "Optional JSON payload. Example: {\"tickers\":[\"AAPL\",\"MSFT\"]}") String payloadJson) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            Map<String, Object> payload = parsePayload(payloadJson);
            var schedule = scheduleService.create(userId, name, cronExpression, taskType, payload, true);
            return "Created cron task: id=" + schedule.getId() + ", name=" + schedule.getName()
                    + ", type=" + schedule.getTaskType() + ", nextRunAt=" + schedule.getNextRunAt();
        } catch (Exception e) {
            log.warn("Failed to create cron task", e);
            return "Error creating cron task: " + e.getMessage();
        }
    }

    @Tool(description = "List all autonomous cron tasks for the current user.")
    public String listCronTasks() {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            var schedules = scheduleService.listByUser(userId);
            if (schedules.isEmpty()) {
                return "No cron tasks configured.";
            }
            StringBuilder sb = new StringBuilder("=== Cron Tasks ===\n");
            for (var s : schedules) {
                sb.append("- ").append(s.getId())
                        .append(" | ").append(s.getName())
                        .append(" | ").append(s.getTaskType())
                        .append(" | ").append(s.isEnabled() ? "ENABLED" : "PAUSED")
                        .append(" | cron=").append(s.getCronExpression())
                        .append("\n");
            }
            return sb.toString();
        } catch (Exception e) {
            return "Error listing cron tasks: " + e.getMessage();
        }
    }

    @Tool(description = "Pause an autonomous cron task by ID.")
    public String pauseCronTask(@ToolParam(description = "Schedule UUID") String scheduleId) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            var updated = scheduleService.setEnabled(userId, UUID.fromString(scheduleId), false);
            return "Paused cron task: " + updated.getId();
        } catch (Exception e) {
            return "Error pausing cron task: " + e.getMessage();
        }
    }

    @Tool(description = "Resume an autonomous cron task by ID.")
    public String resumeCronTask(@ToolParam(description = "Schedule UUID") String scheduleId) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            var updated = scheduleService.setEnabled(userId, UUID.fromString(scheduleId), true);
            return "Resumed cron task: " + updated.getId() + ", nextRunAt=" + updated.getNextRunAt();
        } catch (Exception e) {
            return "Error resuming cron task: " + e.getMessage();
        }
    }

    @Tool(description = "Delete an autonomous cron task by ID.")
    public String deleteCronTask(@ToolParam(description = "Schedule UUID") String scheduleId) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            scheduleService.delete(userId, UUID.fromString(scheduleId));
            return "Deleted cron task: " + scheduleId;
        } catch (Exception e) {
            return "Error deleting cron task: " + e.getMessage();
        }
    }

    @Tool(description = "Configure autonomous heartbeat wake-up behavior. "
            + "Heartbeat checks wallet health periodically and emits alert events on drawdown breaches.")
    public String configureHeartbeat(
            @ToolParam(description = "Enable heartbeat loop") boolean enabled,
            @ToolParam(description = "Heartbeat interval in seconds, e.g. 600") int intervalSeconds,
            @ToolParam(description = "Drawdown alert threshold percent, e.g. 10.0") double drawdownAlertPct) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            var cfg = heartbeatService.updateConfig(
                    userId,
                    enabled,
                    intervalSeconds,
                    BigDecimal.valueOf(drawdownAlertPct)
            );
            return "Heartbeat updated: enabled=" + cfg.isEnabled()
                    + ", intervalSeconds=" + cfg.getIntervalSeconds()
                    + ", drawdownAlertPct=" + cfg.getDrawdownAlertPct();
        } catch (Exception e) {
            return "Error configuring heartbeat: " + e.getMessage();
        }
    }

    @Tool(description = "Show current heartbeat configuration and last wake-up timestamp.")
    public String getHeartbeatConfig() {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            var cfg = heartbeatService.getOrCreateConfig(userId);
            return "Heartbeat config: enabled=" + cfg.isEnabled()
                    + ", intervalSeconds=" + cfg.getIntervalSeconds()
                    + ", drawdownAlertPct=" + cfg.getDrawdownAlertPct()
                    + ", lastBeatAt=" + cfg.getLastBeatAt();
        } catch (Exception e) {
            return "Error reading heartbeat config: " + e.getMessage();
        }
    }

    private Map<String, Object> parsePayload(String payloadJson) {
        if (payloadJson == null || payloadJson.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            return OBJECT_MAPPER.readValue(payloadJson, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalArgumentException("payloadJson must be a valid JSON object");
        }
    }
}
