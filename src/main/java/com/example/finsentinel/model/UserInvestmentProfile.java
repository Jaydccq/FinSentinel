package com.example.finsentinel.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Persistent "Brain" for each user that tracks investment preferences, risk tolerance,
 * emotional state, and analysis history across chat sessions.
 *
 * <p>Inspired by OpenAlice's Brain module (frontalLobe + emotion + commits):
 * <ul>
 *   <li><b>Working Memory (Frontal Lobe)</b> — short summary of user's current investment focus</li>
 *   <li><b>Emotional State</b> — tracks sentiment shifts (FEARFUL to EUPHORIC)</li>
 *   <li><b>State History (Commits)</b> — audit log of all profile state changes</li>
 *   <li><b>Preferences</b> — watchlist, sectors, analysis types as JSONB</li>
 * </ul>
 *
 * <p>This class belongs to the model layer in FinSentinel.
 */
@Entity
@Table(name = "user_investment_profiles")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserInvestmentProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    // === Frontal Lobe (Working Memory) ===
    // Short summary of user's current investment focus/concerns (2-5 sentences)
    @Column(columnDefinition = "text")
    private String workingMemory;

    // === Risk Profile ===
    @Column(length = 20)
    private String riskTolerance;  // CONSERVATIVE, MODERATE, AGGRESSIVE

    @Column(length = 20)
    private String investmentHorizon;  // SHORT_TERM, MEDIUM_TERM, LONG_TERM

    // === Emotional State (OpenAlice emotion tracking) ===
    @Column(length = 30)
    private String currentSentiment;  // FEARFUL, CAUTIOUS, NEUTRAL, OPTIMISTIC, EUPHORIC

    @Column(columnDefinition = "text")
    private String sentimentReason;  // Why the sentiment changed

    // === Preferences (JSONB) ===
    // e.g., { "watchlist": ["AAPL","TSLA"], "sectors": ["Technology","Healthcare"],
    //         "avoidSectors": ["Tobacco"], "preferredAnalysis": ["RSI","MACD"] }
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    @Builder.Default
    private Map<String, Object> preferences = new HashMap<>();

    // === State History (JSONB -- OpenAlice commit log) ===
    // Each entry: { "timestamp": "...", "field": "sentiment", "oldValue": "NEUTRAL",
    //               "newValue": "CAUTIOUS", "reason": "Market volatility spike" }
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    @Builder.Default
    private List<Map<String, Object>> stateHistory = new ArrayList<>();

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
