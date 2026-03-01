package com.example.finsentinel.service.autonomy;

import com.example.finsentinel.model.AgentSchedule;
import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.repository.AgentScheduleRepository;
import com.example.finsentinel.service.event.AgentEventService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

/**
 * Keeps runtime cron task registrations in sync with persisted schedules.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AgentScheduleRegistry {

    @Qualifier("autonomyTaskScheduler")
    private final TaskScheduler taskScheduler;
    private final AgentScheduleRepository scheduleRepository;
    private final AgentScheduledTaskExecutor taskExecutor;
    private final AgentEventService agentEventService;
    private final TransactionTemplate transactionTemplate;

    private final Map<UUID, ScheduledFuture<?>> futures = new ConcurrentHashMap<>();

    @PostConstruct
    public void bootstrap() {
        scheduleRepository.findByEnabledTrue().forEach(this::reschedule);
    }

    public synchronized void reschedule(AgentSchedule schedule) {
        cancel(schedule.getId());
        if (!schedule.isEnabled()) {
            return;
        }
        try {
            CronExpression.parse(schedule.getCronExpression());
            ScheduledFuture<?> future = taskScheduler.schedule(
                    () -> executeScheduleSafely(schedule.getId()),
                    new CronTrigger(schedule.getCronExpression()));
            if (future != null) {
                futures.put(schedule.getId(), future);
            }
        } catch (Exception e) {
            log.warn("Failed to register schedule {}: {}", schedule.getId(), e.getMessage());
        }
    }

    public synchronized void cancel(UUID scheduleId) {
        ScheduledFuture<?> existing = futures.remove(scheduleId);
        if (existing != null) {
            existing.cancel(false);
        }
    }

    private void executeScheduleSafely(UUID scheduleId) {
        var scheduleOpt = scheduleRepository.findById(scheduleId);
        if (scheduleOpt.isEmpty()) {
            cancel(scheduleId);
            return;
        }
        AgentSchedule schedule = scheduleOpt.get();
        if (!schedule.isEnabled()) {
            cancel(scheduleId);
            return;
        }

        try {
            Map<String, Object> taskPayload = taskExecutor.execute(schedule);
            LocalDateTime now = LocalDateTime.now();
            final boolean[] statePersisted = {false};

            transactionTemplate.executeWithoutResult(status ->
                    scheduleRepository.findById(scheduleId).ifPresentOrElse(current -> {
                        if (!current.isEnabled()) {
                            cancel(scheduleId);
                            return;
                        }
                        current.setLastRunAt(now);
                        current.setNextRunAt(nextRunAt(current.getCronExpression(), now));
                        scheduleRepository.save(current);
                        statePersisted[0] = true;
                    }, () -> cancel(scheduleId)));

            if (statePersisted[0]) {
                emit(schedule, AgentEventType.SCHEDULE_EXECUTED, taskPayload, null);
            }
        } catch (Exception e) {
            log.warn("Schedule {} execution failed: {}", scheduleId, e.getMessage());
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("error", e.getMessage());
            emit(schedule, AgentEventType.SCHEDULE_FAILED, payload, null);
        }
    }

    private LocalDateTime nextRunAt(String cron, LocalDateTime baseTime) {
        try {
            return CronExpression.parse(cron)
                    .next(baseTime.atZone(ZoneId.systemDefault()))
                    .toLocalDateTime();
        } catch (Exception e) {
            return null;
        }
    }

    private void emit(AgentSchedule schedule, AgentEventType eventType, Map<String, Object> payload, String idempotencyKey) {
        try {
            agentEventService.append(
                    schedule.getUserId(),
                    AgentEventAggregateType.SCHEDULE,
                    schedule.getId(),
                    eventType,
                    payload,
                    idempotencyKey
            );
        } catch (Exception e) {
            log.warn("Failed to emit schedule event {} for {}: {}", eventType, schedule.getId(), e.getMessage());
        }
    }
}
