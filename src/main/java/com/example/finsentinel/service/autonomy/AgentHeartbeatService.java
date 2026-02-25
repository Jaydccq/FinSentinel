package com.example.finsentinel.service.autonomy;

import com.example.finsentinel.config.AutonomyProperties;
import com.example.finsentinel.util.NumberUtils;
import com.example.finsentinel.model.AgentHeartbeatConfig;
import com.example.finsentinel.model.TradeWallet;
import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.repository.AgentHeartbeatConfigRepository;
import com.example.finsentinel.repository.TradeWalletRepository;
import com.example.finsentinel.service.event.AgentEventService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Manages per-user heartbeat settings and autonomous heartbeat checks.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentHeartbeatService {

    private final AgentHeartbeatConfigRepository heartbeatConfigRepository;
    private final TradeWalletRepository tradeWalletRepository;
    private final AgentEventService agentEventService;
    private final AutonomyProperties autonomyProperties;

    @Transactional
    public AgentHeartbeatConfig getOrCreateConfig(UUID userId) {
        return heartbeatConfigRepository.findById(userId)
                .orElseGet(() -> heartbeatConfigRepository.save(defaultConfig(userId)));
    }

    @Transactional
    public AgentHeartbeatConfig updateConfig(UUID userId, Boolean enabled, Integer intervalSeconds, BigDecimal drawdownAlertPct) {
        AgentHeartbeatConfig config = getOrCreateConfig(userId);

        if (enabled != null) {
            config.setEnabled(enabled);
        }
        if (intervalSeconds != null) {
            config.setIntervalSeconds(clampInterval(intervalSeconds));
        }
        if (drawdownAlertPct != null) {
            if (drawdownAlertPct.compareTo(BigDecimal.ZERO) <= 0) {
                throw new IllegalArgumentException("drawdownAlertPct must be > 0");
            }
            config.setDrawdownAlertPct(drawdownAlertPct.setScale(2, RoundingMode.HALF_UP));
        }
        return heartbeatConfigRepository.save(config);
    }

    @Transactional
    public void dispatchDueHeartbeats() {
        LocalDateTime now = LocalDateTime.now();
        List<AgentHeartbeatConfig> configs = heartbeatConfigRepository.findByEnabledTrue();
        for (AgentHeartbeatConfig cfg : configs) {
            if (isDue(cfg, now)) {
                runHeartbeatOnce(cfg.getUserId(), "dispatcher");
            }
        }
    }

    @Transactional
    public Map<String, Object> runHeartbeatOnce(UUID userId, String triggerSource) {
        AgentHeartbeatConfig cfg = getOrCreateConfig(userId);
        LocalDateTime now = LocalDateTime.now();

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("trigger", triggerSource);
        payload.put("intervalSeconds", cfg.getIntervalSeconds());

        var walletOpt = tradeWalletRepository.findByUserId(userId);
        if (walletOpt.isEmpty()) {
            payload.put("status", "no-wallet");
            cfg.setLastBeatAt(now);
            heartbeatConfigRepository.save(cfg);
            emitTick(userId, payload);
            return payload;
        }

        TradeWallet wallet = walletOpt.get();
        BigDecimal totalValue = wallet.getCashBalance().add(sumPositionValue(wallet));
        BigDecimal drawdownPct = calculateDrawdownPct(wallet.getInitialCapital(), totalValue);
        boolean alert = drawdownPct.compareTo(cfg.getDrawdownAlertPct()) >= 0;

        payload.put("status", "ok");
        payload.put("walletId", wallet.getId());
        payload.put("cashBalance", wallet.getCashBalance());
        payload.put("totalValue", totalValue);
        payload.put("positionCount", wallet.getPositions() != null ? wallet.getPositions().size() : 0);
        payload.put("drawdownPct", drawdownPct);
        payload.put("drawdownAlertPct", cfg.getDrawdownAlertPct());
        payload.put("alert", alert);

        cfg.setLastBeatAt(now);
        heartbeatConfigRepository.save(cfg);
        emitTick(userId, payload);

        if (alert) {
            emitAlert(userId, wallet.getId(), drawdownPct, cfg.getDrawdownAlertPct(), triggerSource);
        }
        return payload;
    }

    private boolean isDue(AgentHeartbeatConfig cfg, LocalDateTime now) {
        if (cfg.getLastBeatAt() == null) {
            return true;
        }
        return !cfg.getLastBeatAt().plusSeconds(cfg.getIntervalSeconds()).isAfter(now);
    }

    private int clampInterval(int intervalSeconds) {
        AutonomyProperties.Heartbeat hb = autonomyProperties.getHeartbeat();
        return Math.min(Math.max(intervalSeconds, hb.getMinIntervalSeconds()), hb.getMaxIntervalSeconds());
    }

    private AgentHeartbeatConfig defaultConfig(UUID userId) {
        AutonomyProperties.Heartbeat hb = autonomyProperties.getHeartbeat();
        return AgentHeartbeatConfig.builder()
                .userId(userId)
                .enabled(hb.isEnabled())
                .intervalSeconds(clampInterval(hb.getDefaultIntervalSeconds()))
                .drawdownAlertPct(hb.getDefaultDrawdownAlertPct().setScale(2, RoundingMode.HALF_UP))
                .build();
    }

    private BigDecimal sumPositionValue(TradeWallet wallet) {
        if (wallet.getPositions() == null || wallet.getPositions().isEmpty()) {
            return BigDecimal.ZERO;
        }
        return wallet.getPositions().stream()
                .map(p -> NumberUtils.toBigDecimal(p.get("shares")).multiply(
                        p.containsKey("currentPrice")
                                ? NumberUtils.toBigDecimal(p.get("currentPrice"))
                                : NumberUtils.toBigDecimal(p.get("avgCost"))))
                .reduce(BigDecimal.ZERO, BigDecimal::add)
                .setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal calculateDrawdownPct(BigDecimal initialCapital, BigDecimal totalValue) {
        if (initialCapital == null || initialCapital.compareTo(BigDecimal.ZERO) <= 0) {
            return BigDecimal.ZERO;
        }
        BigDecimal loss = initialCapital.subtract(totalValue);
        if (loss.compareTo(BigDecimal.ZERO) <= 0) {
            return BigDecimal.ZERO;
        }
        return loss.divide(initialCapital, 6, RoundingMode.HALF_UP)
                .multiply(new BigDecimal("100"))
                .setScale(2, RoundingMode.HALF_UP);
    }

    private void emitTick(UUID userId, Map<String, Object> payload) {
        try {
            agentEventService.append(
                    userId,
                    AgentEventAggregateType.HEARTBEAT,
                    userId,
                    AgentEventType.HEARTBEAT_TICK,
                    payload,
                    null
            );
        } catch (Exception e) {
            log.warn("Failed to emit heartbeat tick for user {}: {}", userId, e.getMessage());
        }
    }

    private void emitAlert(UUID userId, UUID walletId, BigDecimal drawdownPct, BigDecimal thresholdPct, String trigger) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("trigger", trigger);
            payload.put("walletId", walletId);
            payload.put("drawdownPct", drawdownPct);
            payload.put("thresholdPct", thresholdPct);
            String idempotencyKey = "heartbeat-alert:" + userId + ":" + LocalDateTime.now().withMinute(0).withSecond(0).withNano(0);
            agentEventService.append(
                    userId,
                    AgentEventAggregateType.HEARTBEAT,
                    userId,
                    AgentEventType.HEARTBEAT_ALERT,
                    payload,
                    idempotencyKey
            );
        } catch (Exception e) {
            log.warn("Failed to emit heartbeat alert for user {}: {}", userId, e.getMessage());
        }
    }
}
