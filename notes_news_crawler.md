# Notes: 实时新闻爬虫设计详情

## 1. NewsItem 实体设计

```java
@Entity
@Table(name = "news_items", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"source", "sourceId"})
})
public class NewsItem {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 100)
    private String sourceId;           // Polygon article_id / RSS guid

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private NewsSource source;         // POLYGON, RSS_REUTERS, RSS_CNBC, RSS_YAHOO

    @Column(nullable = false)
    private String title;

    @Column(columnDefinition = "text")
    private String summary;            // API description / RSS summary

    private String articleUrl;
    private String author;

    @Column(nullable = false)
    private Instant publishedAt;       // 原始发布时间（解决现有 date=now() 问题）

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tickers;      // 关联 ticker

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tags;         // #earnings #fed #macro 等

    private String sentiment;          // POSITIVE / NEGATIVE / NEUTRAL (可选)

    @Builder.Default
    private boolean enriched = false;  // 正文是否已补全

    private UUID documentId;           // 关联的 Document（补全后设置）

    @CreationTimestamp
    @Column(updatable = false)
    private Instant createdAt;
}
```

### 关键设计决策
- `(source, sourceId)` 唯一约束替代现有 `existsByOriginalFileName(title)` 去重
- `publishedAt` 用 Instant 而非 LocalDateTime，保留时区信息
- `tickers` 和 `tags` 用 JSONB 列，避免额外关联表
- `enriched` + `documentId` 跟踪正文补全状态，将快讯与 RAG Document 关联

---

## 2. NewsSource 枚举

```java
public enum NewsSource {
    POLYGON,
    RSS_REUTERS,
    RSS_CNBC,
    RSS_YAHOO
}
```

---

## 3. NewsFetcher 接口（策略模式）

```java
public interface NewsFetcher {
    NewsSource getSource();
    List<RawNewsItem> fetch(List<String> tickers);
}

// 归一化的中间数据结构
public record RawNewsItem(
    String sourceId,
    NewsSource source,
    String title,
    String summary,
    String articleUrl,
    String author,
    Instant publishedAt,
    List<String> tickers,
    List<String> tags
) {}
```

### PolygonNewsFetcher
- 复用现有 `PolygonProperties` 和 `RestClient`
- 从 `response.results[].id` 提取 sourceId（当前代码用 title 去重，改为 article id）
- 从 `tickers` 数组提取关联 ticker
- 从 `keywords` 提取 tags
- 不调 Firecrawl，仅用 API 返回的 title + description

### RssNewsFetcher
- 使用 Rome (com.rometools:rome) 解析 RSS/Atom
- 免费 RSS 源：
  - Reuters: `https://www.rss.reuters.com/news/economy`（需验证可用性）
  - CNBC: `https://www.cnbc.com/id/100003114/device/rss/rss.html`（Top News）
  - Yahoo Finance: `https://finance.yahoo.com/news/rssindex`
- `guid` 作为 sourceId
- 从 title/description 中提取 ticker（正则 `$[A-Z]{1,5}` 或 NLP）

---

## 4. NewsFetcherService（调度编排）

```java
@Service
@RequiredArgsConstructor
public class NewsFetcherService {
    private final List<NewsFetcher> fetchers;  // Spring 自动注入所有实现
    private final NewsItemRepository repository;
    private final ApplicationEventPublisher eventPublisher;
    private final NewsEnrichProducer enrichProducer;

    @Scheduled(fixedDelayString = "${app.news.poll-interval:60000}")
    public void pollAll() {
        for (NewsFetcher fetcher : fetchers) {
            try {
                List<RawNewsItem> items = fetcher.fetch(getWatchTickers());
                for (RawNewsItem raw : items) {
                    if (!repository.existsBySourceAndSourceId(raw.source(), raw.sourceId())) {
                        NewsItem saved = repository.save(toEntity(raw));
                        eventPublisher.publishEvent(new NewsItemCreatedEvent(saved));
                        enrichProducer.send(saved.getId());  // 异步正文补全
                    }
                }
            } catch (Exception e) {
                log.error("Fetch failed for {}", fetcher.getSource(), e);
            }
        }
    }
}
```

### 关键点
- `@Scheduled` 定时轮询，间隔可配置（默认60s）
- 去重用 `existsBySourceAndSourceId`（有唯一索引，O(1)）
- 新快讯通过 `ApplicationEventPublisher` 发布事件，SSE 订阅该事件
- 同时发送到 Redis Stream 触发正文补全

---

## 5. 正文补全流水线

### Redis Stream: `stream:news-enrich`
```
NewsEnrichProducer.send(newsItemId) → Redis Stream
                                        ↓
NewsEnrichConsumer (poll every 2s)
  → newsItemRepository.findById(id)
  → firecrawlClient.scrape(articleUrl) → markdown
  → MarkdownToPdfConverter → byte[]
  → storageService.upload("news/{ticker}/{uuid}.pdf")
  → documentRepository.save(Document{NEWS, publishedAt, sector, ...})
  → vectorizeStreamProducer.send(doc.getId())  // 触发向量化
  → newsItem.setEnriched(true)
  → newsItem.setDocumentId(doc.getId())
  → newsItemRepository.save(newsItem)
```

### 与现有 VectorizeStreamConsumer 的关系
- NewsEnrichConsumer 负责：Firecrawl 正文 → PDF → Document → 触发向量化
- VectorizeStreamConsumer 负责：下载 PDF → Tika 解析 → 分块 → 嵌入 → pgvector
- 两个消费者串行：news-enrich → vectorize

### 关键改进：publishedAt 传递
- Document 实体当前没有 publishedAt 字段
- DocumentVectorService 始终写 `date = LocalDate.now()`
- 改进：在 metadata 中写入 `newsItem.publishedAt` 而非 now()
- 方案：DocumentVectorService.vectorize() 增加可选 `publishedDate` 参数

---

## 6. SSE 推送机制

```java
@RestController
@RequestMapping("/api/news")
public class NewsController {
    private final SseEmitterRegistry emitterRegistry = new CopyOnWriteArrayList<>();

    // SSE endpoint
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream() {
        SseEmitter emitter = new SseEmitter(0L);  // no timeout
        emitterRegistry.add(emitter);
        emitter.onCompletion(() -> emitterRegistry.remove(emitter));
        emitter.onTimeout(() -> emitterRegistry.remove(emitter));
        return emitter;
    }

    // Spring Event listener — 新快讯入库时推送
    @EventListener
    public void onNewsItem(NewsItemCreatedEvent event) {
        NewsItemResponse dto = mapToResponse(event.getNewsItem());
        for (SseEmitter emitter : emitterRegistry) {
            try {
                emitter.send(SseEmitter.event()
                    .name("news")
                    .data(dto, MediaType.APPLICATION_JSON));
            } catch (IOException e) {
                emitterRegistry.remove(emitter);
            }
        }
    }

    // REST: 分页查询
    @GetMapping
    public Page<NewsItemResponse> list(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "50") int size,
        @RequestParam(required = false) String ticker,
        @RequestParam(required = false) NewsSource source) { ... }

    // REST: 统计
    @GetMapping("/stats")
    public NewsFeedStatsResponse stats() { ... }
}
```

---

## 7. 前端 NewsPage 设计

参考用户截图，UI 分两栏：

### 左栏：快讯列表
- 每条：时间戳 + 标题 + 摘要（可展开） + ticker tags + source badge
- 按 publishedAt DESC 排列
- SSE 新数据自动 prepend 到列表顶部（带淡入动画）
- 无限滚动加载历史（GET /api/news?page=N）

### 右栏：统计面板
- 今日快讯数 / 本周快讯数
- 按来源分布（饼图或数字）
- 按 ticker 分布 Top 5
- 情绪分布（如果有 sentiment）

---

## 8. 配置 (application.yaml)

```yaml
app:
  news:
    enabled: true
    poll-interval: 60000      # ms, Polygon 轮询间隔
    rss-poll-interval: 120000 # ms, RSS 轮询间隔
    watch-tickers:
      - AAPL
      - MSFT
      - GOOGL
      - TSLA
      - JPM
      - NVDA
    rss-feeds:
      - name: CNBC Top News
        url: https://www.cnbc.com/id/100003114/device/rss/rss.html
        source: RSS_CNBC
      - name: Yahoo Finance
        url: https://finance.yahoo.com/news/rssindex
        source: RSS_YAHOO
    retention-days: 30        # 快讯保留天数
    enrich:
      enabled: true           # 正文补全开关
      batch-size: 5           # 每次消费几条
```

---

## 9. 依赖新增

```gradle
// RSS 解析
implementation 'com.rometools:rome:2.1.0'
```

---

## 10. 与现有 PolygonNewsScraper 的关系

现有 `PolygonNewsScraper` 是全量批处理模式（手动触发 → 抓取50条 → Firecrawl 全文 → PDF → Document → 向量化），适合初始化知识库。

新 `PolygonNewsFetcher` 是增量轮询模式（定时 → 只拉新快讯 → 先入 news_items → 异步补全文）。

两者可共存：
- PolygonNewsScraper: `/api/scraper/news` — 手动批量导入历史数据
- PolygonNewsFetcher: 自动增量轮询 — 实时新闻流

---

## 11. 实现顺序（避免编译错误）

1. NewsSource 枚举
2. NewsItem 实体 + Repository
3. DTOs (NewsItemResponse, NewsFeedStatsResponse)
4. NewsProperties 配置
5. NewsFetcher 接口 + RawNewsItem record
6. PolygonNewsFetcher
7. RssNewsFetcher
8. VectorizeStreamConstants 添加 NEWS_ENRICH key
9. NewsEnrichProducer (类似 VectorizeStreamProducer)
10. NewsFetcherService (调度 + 事件发布)
11. NewsEnrichConsumer (正文补全)
12. NewsController (REST + SSE)
13. 前端 news.ts API client
14. NewsPage.tsx
15. App.tsx 路由 + Sidebar 导航
16. application.yaml 配置
17. 测试
