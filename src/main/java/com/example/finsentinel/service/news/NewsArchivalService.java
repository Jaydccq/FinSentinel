package com.example.finsentinel.service.news;

import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.NewsItem;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.repository.NewsItemRepository;
import com.example.finsentinel.service.storage.StorageService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

@Slf4j
@Service
@ConditionalOnExpression("${app.archival.enabled:false} and '${app.storage.provider}' == 'hybrid'")
public class NewsArchivalService {

    private final NewsItemRepository newsItemRepository;
    private final DocumentRepository documentRepository;
    private final StorageService hotStorage;
    private final StorageService coldStorage;

    @Value("${app.archival.retention-days:7}")
    private int retentionDays;

    @Value("${app.archival.batch-size:50}")
    private int batchSize;

    public NewsArchivalService(NewsItemRepository newsItemRepository,
                                DocumentRepository documentRepository,
                                @Qualifier("rustfsStorage") StorageService hotStorage,
                                @Qualifier("googleDriveStorage") StorageService coldStorage) {
        this.newsItemRepository = newsItemRepository;
        this.documentRepository = documentRepository;
        this.hotStorage = hotStorage;
        this.coldStorage = coldStorage;
    }

    @Scheduled(cron = "${app.archival.cron:0 0 2 * * *}")
    public void archiveOldNews() {
        Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        log.info("Starting news archival for items older than {} ({} day retention)", cutoff, retentionDays);

        List<NewsItem> oldItems = newsItemRepository.findArchivableBefore(
                cutoff, PageRequest.of(0, batchSize));

        if (oldItems.isEmpty()) {
            log.debug("No news items to archive");
            return;
        }

        int archived = 0;
        int failed = 0;

        for (NewsItem newsItem : oldItems) {
            try {
                Document doc = documentRepository.findById(newsItem.getDocumentId()).orElse(null);
                if (doc == null || doc.getStorageKey() == null) continue;

                String hotKey = doc.getStorageKey();

                // Skip if already archived (key starts with news-archive/)
                if (hotKey.startsWith("news-archive/")) {
                    log.debug("Document {} already archived, skipping", doc.getId());
                    continue;
                }

                String coldKey = "news-archive/" + hotKey;

                // Copy hot -> cold
                byte[] content = hotStorage.download(hotKey);
                coldStorage.upload(coldKey, content, "application/pdf");

                // Delete from hot storage
                hotStorage.delete(hotKey);

                // Update document record to point to cold storage
                doc.setStorageKey(coldKey);
                documentRepository.save(doc);

                archived++;
                log.debug("Archived news document {} to cold storage: {}", doc.getId(), coldKey);

            } catch (Exception e) {
                failed++;
                log.warn("Failed to archive news item {}: {}", newsItem.getId(), e.getMessage());
            }
        }

        log.info("News archival complete: {} archived, {} failed out of {} candidates",
                archived, failed, oldItems.size());
    }
}
