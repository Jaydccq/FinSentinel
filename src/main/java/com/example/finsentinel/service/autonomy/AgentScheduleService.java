package com.example.finsentinel.service.autonomy;

import com.example.finsentinel.config.AutonomyProperties;
import com.example.finsentinel.model.AgentSchedule;
import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.model.enums.AgentScheduleTaskType;
import com.example.finsentinel.repository.AgentScheduleRepository;
import com.example.finsentinel.service.event.AgentEventService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * CRUD service for user-managed autonomous cron schedules.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentScheduleService {

    private final AgentScheduleRepository scheduleRepository;
    private final AgentScheduleRegistry scheduleRegistry;
    private final AgentEventService agentEventService;
    private final AutonomyProperties autonomyProperties;

    @Transactional(readOnly = true)
    public List<AgentSchedule> listByUser(UUID userId) {
        return scheduleRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    @Transactional
    public AgentSchedule create(UUID userId,
                                String name,
                                String cronExpression,
                                String taskType,
                                Map<String, Object> payload,
                                Boolean enabled) {
        long count = scheduleRepository.countByUserId(userId);
        if (count >= autonomyProperties.getMaxSchedulesPerUser()) {
            throw new IllegalArgumentException(
                    "Maximum schedule limit reached (" + autonomyProperties.getMaxSchedulesPerUser()
                    + "). Delete unused schedules first.");
        }
        String normalizedCron = normalizeCron(cronExpression);
        AgentScheduleTaskType type = parseTaskType(taskType);
        boolean isEnabled = enabled == null || enabled;

        AgentSchedule schedule = AgentSchedule.builder()
                .userId(userId)
                .name(normalizeName(name))
                .cronExpression(normalizedCron)
                .taskType(type)
                .taskPayload(payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload))
                .enabled(isEnabled)
                .nextRunAt(nextRunAt(normalizedCron))
                .build();
        AgentSchedule saved = scheduleRepository.save(schedule);
        scheduleRegistry.reschedule(saved);
        emit(saved, AgentEventType.SCHEDULE_CREATED, Map.of("taskType", type.name(), "enabled", isEnabled));
        return saved;
    }

    @Transactional
    public AgentSchedule update(UUID userId,
                                UUID scheduleId,
                                String name,
                                String cronExpression,
                                String taskType,
                                Map<String, Object> payload,
                                Boolean enabled) {
        AgentSchedule schedule = scheduleRepository.findByIdAndUserId(scheduleId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Schedule not found"));

        String normalizedCron = normalizeCron(cronExpression);
        AgentScheduleTaskType type = parseTaskType(taskType);
        schedule.setName(normalizeName(name));
        schedule.setCronExpression(normalizedCron);
        schedule.setTaskType(type);
        schedule.setTaskPayload(payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload));
        schedule.setEnabled(enabled == null || enabled);
        schedule.setNextRunAt(nextRunAt(normalizedCron));
        AgentSchedule saved = scheduleRepository.save(schedule);
        scheduleRegistry.reschedule(saved);
        emit(saved, AgentEventType.SCHEDULE_UPDATED, Map.of("taskType", type.name(), "enabled", saved.isEnabled()));
        return saved;
    }

    @Transactional
    public AgentSchedule setEnabled(UUID userId, UUID scheduleId, boolean enabled) {
        AgentSchedule schedule = scheduleRepository.findByIdAndUserId(scheduleId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Schedule not found"));
        schedule.setEnabled(enabled);
        schedule.setNextRunAt(enabled ? nextRunAt(schedule.getCronExpression()) : null);
        AgentSchedule saved = scheduleRepository.save(schedule);
        scheduleRegistry.reschedule(saved);
        emit(saved, AgentEventType.SCHEDULE_UPDATED, Map.of("enabled", enabled));
        return saved;
    }

    @Transactional
    public void delete(UUID userId, UUID scheduleId) {
        AgentSchedule schedule = scheduleRepository.findByIdAndUserId(scheduleId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Schedule not found"));
        scheduleRepository.delete(schedule);
        scheduleRegistry.cancel(scheduleId);
        emit(schedule, AgentEventType.SCHEDULE_DELETED, Map.of("scheduleId", scheduleId));
    }

    private String normalizeName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Schedule name is required");
        }
        String trimmed = name.trim();
        if (trimmed.length() > 120) {
            throw new IllegalArgumentException("Schedule name is too long");
        }
        return trimmed;
    }

    private String normalizeCron(String cronExpression) {
        if (cronExpression == null || cronExpression.isBlank()) {
            throw new IllegalArgumentException("Cron expression is required");
        }
        String cron = cronExpression.trim();
        try {
            CronExpression.parse(cron);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid cron expression");
        }
        return cron;
    }

    private AgentScheduleTaskType parseTaskType(String taskType) {
        if (taskType == null || taskType.isBlank()) {
            throw new IllegalArgumentException("Task type is required");
        }
        try {
            return AgentScheduleTaskType.valueOf(taskType.trim().toUpperCase());
        } catch (Exception e) {
            throw new IllegalArgumentException("Unsupported task type: " + taskType);
        }
    }

    private LocalDateTime nextRunAt(String cron) {
        return CronExpression.parse(cron)
                .next(LocalDateTime.now().atZone(ZoneId.systemDefault()))
                .toLocalDateTime();
    }

    private void emit(AgentSchedule schedule, AgentEventType eventType, Map<String, Object> payload) {
        try {
            agentEventService.append(
                    schedule.getUserId(),
                    AgentEventAggregateType.SCHEDULE,
                    schedule.getId(),
                    eventType,
                    payload,
                    null
            );
        } catch (Exception e) {
            log.warn("Failed to emit {} for schedule {}: {}", eventType, schedule.getId(), e.getMessage());
        }
    }
}
