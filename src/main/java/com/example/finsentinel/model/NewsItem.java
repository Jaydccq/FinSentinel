package com.example.finsentinel.model;

import com.example.finsentinel.model.enums.NewsSource;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "news_items", uniqueConstraints = {
        @UniqueConstraint(name = "uk_news_source_source_id", columnNames = {"source", "source_id"})
}, indexes = {
        @Index(name = "idx_news_published_at", columnList = "published_at DESC"),
        @Index(name = "idx_news_enriched", columnList = "enriched")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class NewsItem {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "source_id", nullable = false, length = 200)
    private String sourceId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private NewsSource source;

    @Column(nullable = false)
    private String title;

    @Column(columnDefinition = "text")
    private String summary;

    private String articleUrl;

    private String author;

    @Column(name = "published_at", nullable = false)
    private Instant publishedAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tickers;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tags;

    private String sentiment;

    @Builder.Default
    private boolean enriched = false;

    private UUID documentId;

    @CreationTimestamp
    @Column(updatable = false)
    private Instant createdAt;
}
