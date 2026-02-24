package com.example.finsentinel.model;

import com.example.finsentinel.model.enums.TradingMode;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Paper trading wallet entity implementing the OpenAlice git-like wallet pattern.
 *
 * <p>Each user has one wallet that tracks simulated positions, cash balance,
 * and an immutable commit history of all trading decisions. The commit history
 * provides a full audit trail of what was traded, why (commit message), and
 * what happened (execution results).
 *
 * <p>This class belongs to the model layer in FinSentinel.
 */
@Entity
@Table(name = "trade_wallets")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TradeWallet {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    /**
     * Starting capital (default $100,000 for paper trading).
     */
    @Column(precision = 15, scale = 2, nullable = false)
    @Builder.Default
    private BigDecimal initialCapital = new BigDecimal("100000.00");

    /**
     * Current cash balance available for trading.
     */
    @Column(precision = 15, scale = 2, nullable = false)
    @Builder.Default
    private BigDecimal cashBalance = new BigDecimal("100000.00");

    /**
     * Trading execution mode for this wallet.
     */
    @Enumerated(EnumType.STRING)
    @Column(length = 10, nullable = false)
    @Builder.Default
    private TradingMode tradingMode = TradingMode.PAPER;

    /**
     * Current positions as JSONB.
     * <p>Structure: [{"ticker":"AAPL","shares":10,"avgCost":150.00,"currentPrice":175.00}, ...]
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    @Builder.Default
    private List<Map<String, Object>> positions = new ArrayList<>();

    /**
     * Commit history as JSONB (OpenAlice commit log pattern).
     * <p>Each entry: {"hash":"abc123","parentHash":"def456","message":"Going long AAPL",
     * "operations":[...],"results":[...],"walletStateAfter":{...},"timestamp":"..."}
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    @Builder.Default
    private List<Map<String, Object>> commitHistory = new ArrayList<>();

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
