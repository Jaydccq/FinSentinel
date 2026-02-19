package com.example.finsentinel.repository;

import com.example.finsentinel.model.NewsItem;
import com.example.finsentinel.model.enums.NewsSource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface NewsItemRepository extends JpaRepository<NewsItem, UUID> {

    boolean existsBySourceAndSourceId(NewsSource source, String sourceId);

    Page<NewsItem> findAllByOrderByPublishedAtDesc(Pageable pageable);

    @Query("""
            SELECT n FROM NewsItem n
            WHERE (:source IS NULL OR n.source = :source)
            ORDER BY n.publishedAt DESC
            """)
    Page<NewsItem> findByOptionalSource(@Param("source") NewsSource source, Pageable pageable);

    long countByCreatedAtAfter(Instant after);

    @Query(value = """
            SELECT n.source AS source, COUNT(*) AS cnt
            FROM news_items n
            WHERE n.created_at > :after
            GROUP BY n.source
            """, nativeQuery = true)
    List<Object[]> countBySourceAfter(@Param("after") Instant after);

    List<NewsItem> findByEnrichedFalseOrderByCreatedAtAsc(Pageable pageable);
}
