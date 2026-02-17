# Phase 5: SSE Streaming & REST API — Implementation Plan

## Overview

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 5.1 | SSE streaming chat endpoint | ChatController, ChatService, ChatControllerTest | GlobalExceptionHandler |
| 5.2 | Portfolio CRUD REST endpoints | PortfolioController, PortfolioService, PortfolioControllerTest | PortfolioRepository |
| 5.3 | Market data proxy endpoint | MarketDataController, MarketDataControllerTest | — |
| 5.4 | Redis cache market data (TTL) | MarketDataService, MarketDataServiceTest | StockMarketTool |

---

## Task 5.1: SSE Streaming Chat Endpoint

### Goal
Create a chat controller with SSE streaming (typewriter effect) and structured assessment endpoints. Persist chat history.

### Files to Create

#### 1. `service/ChatService.java`
**Location**: `src/main/java/com/example/finsentinel/service/ChatService.java`

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class ChatService {

    private final RiskAgentService riskAgentService;
    private final ChatMessageRepository chatMessageRepository;
    private final UserRepository userRepository;

    // Save user message, stream AI response, save AI response after completion
    public void streamChat(String message, UUID sessionId, UUID portfolioId,
                           UUID userId, SseEmitter emitter) {
        // 1. Generate sessionId if null
        UUID session = sessionId != null ? sessionId : UUID.randomUUID();

        // 2. Persist user message
        persistMessage(userId, session, "user", message);

        // 3. Stream AI response via SseEmitter
        StringBuilder fullResponse = new StringBuilder();
        riskAgentService.assessStream(message, portfolioId)
            .doOnNext(chunk -> {
                try {
                    fullResponse.append(chunk);
                    emitter.send(SseEmitter.event()
                        .name("message")
                        .data(Map.of("content", chunk, "sessionId", session.toString())));
                } catch (IOException e) {
                    emitter.completeWithError(e);
                }
            })
            .doOnComplete(() -> {
                persistMessage(userId, session, "assistant", fullResponse.toString());
                try {
                    emitter.send(SseEmitter.event().name("done").data("[DONE]"));
                } catch (IOException ignored) {}
                emitter.complete();
            })
            .doOnError(error -> {
                log.error("Stream error", error);
                try {
                    emitter.send(SseEmitter.event().name("error")
                        .data(Map.of("message", error.getMessage())));
                } catch (IOException ignored) {}
                emitter.completeWithError(error);
            })
            .subscribe();
    }

    // Non-streaming structured assessment
    public RiskReport assess(String message, UUID portfolioId, UUID userId, UUID sessionId) {
        UUID session = sessionId != null ? sessionId : UUID.randomUUID();
        persistMessage(userId, session, "user", message);
        RiskReport report = riskAgentService.assess(message, portfolioId);
        persistMessage(userId, session, "assistant", report.toString());
        return report;
    }

    public List<ChatMessage> getSessionHistory(UUID sessionId) {
        return chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(sessionId);
    }

    public List<ChatMessage> getUserHistory(UUID userId) {
        return chatMessageRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    private void persistMessage(UUID userId, UUID sessionId, String role, String content) {
        chatMessageRepository.save(ChatMessage.builder()
            .userId(userId).sessionId(sessionId).role(role).content(content).build());
    }
}
```

#### 2. `controller/ChatController.java`
**Location**: `src/main/java/com/example/finsentinel/controller/ChatController.java`

```java
@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;
    private final UserRepository userRepository;

    // SSE streaming endpoint (typewriter effect)
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamChat(@Valid @RequestBody ChatRequest request,
                                  @RequestParam(required = false) UUID portfolioId,
                                  @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        SseEmitter emitter = new SseEmitter(120_000L); // 2 minute timeout
        chatService.streamChat(request.message(), request.sessionId(),
                portfolioId, user.getId(), emitter);
        return emitter;
    }

    // Structured risk assessment (non-streaming)
    @PostMapping("/assess")
    public ResponseEntity<RiskReport> assess(@Valid @RequestBody ChatRequest request,
                                              @RequestParam(required = false) UUID portfolioId,
                                              @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        RiskReport report = chatService.assess(request.message(), portfolioId,
                user.getId(), request.sessionId());
        return ResponseEntity.ok(report);
    }

    // Get chat history for a session
    @GetMapping("/sessions/{sessionId}")
    public ResponseEntity<List<ChatMessageResponse>> getSessionHistory(@PathVariable UUID sessionId) {
        return ResponseEntity.ok(chatService.getSessionHistory(sessionId).stream()
                .map(this::toResponse).toList());
    }

    private User resolveUser(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"));
    }

    private ChatMessageResponse toResponse(ChatMessage msg) {
        return new ChatMessageResponse(msg.getId(), msg.getSessionId(),
                msg.getRole(), msg.getContent(), msg.getCreatedAt());
    }
}
```

#### 3. `dto/chat/ChatMessageResponse.java`
```java
public record ChatMessageResponse(
    UUID id, UUID sessionId, String role, String content, LocalDateTime createdAt
) {}
```

### Test: `ChatControllerTest.java`
```java
// Test SSE streaming returns TEXT_EVENT_STREAM
// Test /assess returns structured RiskReport
// Test /sessions/{id} returns chat history
// Test auth required (401 without token)
```

---

## Task 5.2: Portfolio CRUD REST Endpoints

### Goal
Full CRUD for portfolios and holdings with ownership validation.

### Files to Create

#### 1. `service/PortfolioService.java`
**Location**: `src/main/java/com/example/finsentinel/service/PortfolioService.java`

```java
@Service
@RequiredArgsConstructor
@Transactional
public class PortfolioService {

    private final PortfolioRepository portfolioRepository;
    private final HoldingRepository holdingRepository;
    private final UserRepository userRepository;

    // Create portfolio for user
    public PortfolioResponse create(PortfolioRequest request, UUID userId) {
        User user = userRepository.findById(userId)
            .orElseThrow(() -> new IllegalArgumentException("User not found"));
        Portfolio portfolio = Portfolio.builder()
            .name(request.name()).description(request.description())
            .user(user).totalValue(BigDecimal.ZERO).build();
        return toResponse(portfolioRepository.save(portfolio));
    }

    // List all portfolios for user
    @Transactional(readOnly = true)
    public List<PortfolioResponse> listByUser(UUID userId) {
        return portfolioRepository.findByUserId(userId).stream()
            .map(this::toResponse).toList();
    }

    // Get single portfolio (with ownership check)
    @Transactional(readOnly = true)
    public PortfolioResponse getById(UUID portfolioId, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        return toResponse(p);
    }

    // Update portfolio name/description
    public PortfolioResponse update(UUID portfolioId, PortfolioRequest request, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        p.setName(request.name());
        p.setDescription(request.description());
        return toResponse(portfolioRepository.save(p));
    }

    // Delete portfolio (cascades to holdings + risk reports)
    public void delete(UUID portfolioId, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        portfolioRepository.delete(p);
    }

    // --- Holding operations ---

    public HoldingResponse addHolding(UUID portfolioId, HoldingRequest request, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        Holding holding = Holding.builder()
            .portfolio(p).symbol(request.symbol().toUpperCase())
            .companyName(request.companyName()).quantity(request.quantity())
            .averageCost(request.averageCost()).sector(request.sector()).build();
        holding = holdingRepository.save(holding);
        recalculateTotalValue(p);
        return toHoldingResponse(holding);
    }

    @Transactional(readOnly = true)
    public List<HoldingResponse> listHoldings(UUID portfolioId, UUID userId) {
        findOwnedPortfolio(portfolioId, userId); // ownership check
        return holdingRepository.findByPortfolioId(portfolioId).stream()
            .map(this::toHoldingResponse).toList();
    }

    public HoldingResponse updateHolding(UUID portfolioId, UUID holdingId,
                                          HoldingRequest request, UUID userId) {
        findOwnedPortfolio(portfolioId, userId);
        Holding h = holdingRepository.findById(holdingId)
            .orElseThrow(() -> new IllegalArgumentException("Holding not found"));
        h.setSymbol(request.symbol().toUpperCase());
        h.setCompanyName(request.companyName());
        h.setQuantity(request.quantity());
        h.setAverageCost(request.averageCost());
        h.setSector(request.sector());
        h = holdingRepository.save(h);
        recalculateTotalValue(h.getPortfolio());
        return toHoldingResponse(h);
    }

    public void deleteHolding(UUID portfolioId, UUID holdingId, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        holdingRepository.deleteById(holdingId);
        recalculateTotalValue(p);
    }

    // --- Helpers ---

    private Portfolio findOwnedPortfolio(UUID portfolioId, UUID userId) {
        Portfolio p = portfolioRepository.findById(portfolioId)
            .orElseThrow(() -> new IllegalArgumentException("Portfolio not found"));
        if (!p.getUser().getId().equals(userId)) {
            throw new IllegalArgumentException("Portfolio not found"); // don't leak existence
        }
        return p;
    }

    private void recalculateTotalValue(Portfolio portfolio) {
        BigDecimal total = holdingRepository.findByPortfolioId(portfolio.getId()).stream()
            .map(h -> {
                BigDecimal price = h.getCurrentPrice() != null ? h.getCurrentPrice() : h.getAverageCost();
                return h.getQuantity().multiply(price);
            })
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        portfolio.setTotalValue(total);
        portfolioRepository.save(portfolio);
    }

    private PortfolioResponse toResponse(Portfolio p) {
        List<HoldingResponse> holdings = p.getHoldings() != null
            ? p.getHoldings().stream().map(this::toHoldingResponse).toList()
            : List.of();
        return new PortfolioResponse(p.getId(), p.getName(), p.getDescription(),
                p.getTotalValue(), holdings, p.getCreatedAt());
    }

    private HoldingResponse toHoldingResponse(Holding h) {
        return new HoldingResponse(h.getId(), h.getSymbol(), h.getCompanyName(),
                h.getQuantity(), h.getAverageCost(), h.getCurrentPrice(), h.getSector());
    }
}
```

#### 2. `controller/PortfolioController.java`
**Location**: `src/main/java/com/example/finsentinel/controller/PortfolioController.java`

```java
@RestController
@RequestMapping("/api/portfolios")
@RequiredArgsConstructor
public class PortfolioController {

    private final PortfolioService portfolioService;
    private final UserRepository userRepository;

    @PostMapping
    public ResponseEntity<PortfolioResponse> create(
            @Valid @RequestBody PortfolioRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        UUID userId = resolveUserId(userDetails);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(portfolioService.create(request, userId));
    }

    @GetMapping
    public ResponseEntity<List<PortfolioResponse>> list(
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.listByUser(resolveUserId(userDetails)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<PortfolioResponse> get(
            @PathVariable UUID id,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.getById(id, resolveUserId(userDetails)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<PortfolioResponse> update(
            @PathVariable UUID id,
            @Valid @RequestBody PortfolioRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.update(id, request, resolveUserId(userDetails)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID id,
            @AuthenticationPrincipal UserDetails userDetails) {
        portfolioService.delete(id, resolveUserId(userDetails));
        return ResponseEntity.noContent().build();
    }

    // --- Holding sub-resource ---

    @PostMapping("/{portfolioId}/holdings")
    public ResponseEntity<HoldingResponse> addHolding(
            @PathVariable UUID portfolioId,
            @Valid @RequestBody HoldingRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(portfolioService.addHolding(portfolioId, request, resolveUserId(userDetails)));
    }

    @GetMapping("/{portfolioId}/holdings")
    public ResponseEntity<List<HoldingResponse>> listHoldings(
            @PathVariable UUID portfolioId,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.listHoldings(portfolioId, resolveUserId(userDetails)));
    }

    @PutMapping("/{portfolioId}/holdings/{holdingId}")
    public ResponseEntity<HoldingResponse> updateHolding(
            @PathVariable UUID portfolioId,
            @PathVariable UUID holdingId,
            @Valid @RequestBody HoldingRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.updateHolding(
                portfolioId, holdingId, request, resolveUserId(userDetails)));
    }

    @DeleteMapping("/{portfolioId}/holdings/{holdingId}")
    public ResponseEntity<Void> deleteHolding(
            @PathVariable UUID portfolioId,
            @PathVariable UUID holdingId,
            @AuthenticationPrincipal UserDetails userDetails) {
        portfolioService.deleteHolding(portfolioId, holdingId, resolveUserId(userDetails));
        return ResponseEntity.noContent().build();
    }

    private UUID resolveUserId(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"))
                .getId();
    }
}
```

### Tests: `PortfolioServiceTest.java`
- create_shouldReturnPortfolioWithZeroValue
- listByUser_shouldReturnOnlyOwnedPortfolios
- getById_shouldThrowForWrongOwner
- update_shouldModifyNameAndDescription
- delete_shouldCascadeHoldings
- addHolding_shouldRecalculateTotalValue
- updateHolding_shouldUpdateFields
- deleteHolding_shouldRecalculateTotalValue

---

## Task 5.3: Market Data Proxy Endpoint

### Goal
REST proxy for frontend to fetch market data without exposing Polygon.io API key.

### Files to Create

#### 1. `controller/MarketDataController.java`
```java
@RestController
@RequestMapping("/api/market")
@RequiredArgsConstructor
public class MarketDataController {

    private final MarketDataService marketDataService;

    @GetMapping("/quote/{ticker}")
    public ResponseEntity<Map<String, Object>> getQuote(@PathVariable String ticker) {
        return ResponseEntity.ok(marketDataService.getQuote(ticker));
    }

    @GetMapping("/history/{ticker}")
    public ResponseEntity<JsonNode> getHistory(
            @PathVariable String ticker,
            @RequestParam(defaultValue = "30") int days) {
        return ResponseEntity.ok(marketDataService.getHistory(ticker, days));
    }

    @PostMapping("/batch-quotes")
    public ResponseEntity<Map<String, Object>> getBatchQuotes(
            @RequestBody List<String> tickers) {
        return ResponseEntity.ok(marketDataService.getBatchQuotes(tickers));
    }
}
```

### Test: `MarketDataControllerTest.java`
- getQuote_shouldReturnCachedData
- getHistory_shouldReturn30DaysBars
- batchQuotes_shouldReturnMultipleTickers
- invalidTicker_shouldReturn400

---

## Task 5.4: Redis Cache Market Data (TTL Rate-Limit Protection)

### Goal
Extract market data caching into a reusable service. Centralize TTL logic. Refactor StockMarketTool to delegate.

### Files to Create

#### 1. `service/MarketDataService.java`
**Location**: `src/main/java/com/example/finsentinel/service/MarketDataService.java`

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class MarketDataService {

    private final RestClient restClient;
    private final PolygonProperties polygonProperties;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    private static final Duration QUOTE_TTL = Duration.ofMinutes(5);
    private static final Duration HISTORY_TTL = Duration.ofMinutes(30);

    // Returns structured quote data as Map (for REST proxy)
    public Map<String, Object> getQuote(String ticker) {
        ticker = validateTicker(ticker);
        String cacheKey = "market:quote:" + ticker;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return parseJson(cached);
        }

        JsonNode bar = fetchLatestBar(ticker);
        Map<String, Object> result = Map.of(
            "ticker", ticker,
            "close", bar.get("c").asDouble(),
            "open", bar.get("o").asDouble(),
            "high", bar.get("h").asDouble(),
            "low", bar.get("l").asDouble(),
            "volume", bar.get("v").asLong(),
            "timestamp", bar.get("t").asLong()
        );
        cacheResult(cacheKey, result, QUOTE_TTL);
        return result;
    }

    // Returns historical OHLCV bars as JsonNode (for charting)
    public JsonNode getHistory(String ticker, int days) {
        ticker = validateTicker(ticker);
        days = Math.min(Math.max(days, 1), 365);
        String cacheKey = "market:history:" + ticker + ":" + days;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return parseJsonNode(cached);
        }

        String to = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
        String from = LocalDate.now().minusDays(days).format(DateTimeFormatter.ISO_LOCAL_DATE);
        JsonNode response = callPolygonAggs(ticker, from, to, "asc", days + 10);
        JsonNode results = response.get("results");
        cacheString(cacheKey, results.toString(), HISTORY_TTL);
        return results;
    }

    // Batch quotes for portfolio view
    public Map<String, Object> getBatchQuotes(List<String> tickers) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String ticker : tickers) {
            try {
                result.put(ticker.toUpperCase(), getQuote(ticker));
            } catch (Exception e) {
                result.put(ticker.toUpperCase(), Map.of("error", e.getMessage()));
            }
        }
        return result;
    }

    // --- Text format for AI tools ---
    public String getQuoteText(String ticker) {
        // Human-readable format for StockMarketTool
    }

    public String getHistoryJson(String ticker, int days) {
        // JSON string format for StockMarketTool
    }

    // --- Private helpers ---
    private String validateTicker(String ticker) { ... }
    private JsonNode fetchLatestBar(String ticker) { ... }
    private JsonNode callPolygonAggs(String ticker, String from, String to, String sort, int limit) { ... }
}
```

### Files to Modify

#### `StockMarketTool.java` — delegate to MarketDataService
```java
// Before: Direct RestClient + Redis calls
// After: Delegate to MarketDataService
@Tool(description = "Get real-time stock market data...")
public String getStockQuote(String ticker) {
    return marketDataService.getQuoteText(ticker);
}
```

### Test: `MarketDataServiceTest.java`
- getQuote_shouldReturnStructuredData
- getQuote_shouldUseCacheOnSecondCall
- getHistory_shouldRespectDaysBounds
- getBatchQuotes_shouldHandleMixedResults
- validateTicker_shouldRejectInvalidSymbols

---

## Execution Order

### Batch 1: Tasks 5.4 + 5.2 (foundations)
1. **MarketDataService** (5.4) — extract from StockMarketTool, add tests
2. **PortfolioService + PortfolioController** (5.2) — full CRUD with tests
3. Verify: `./gradlew compileJava && ./gradlew test`

### Batch 2: Tasks 5.3 + 5.1 (API layer)
4. **MarketDataController** (5.3) — proxy using MarketDataService
5. **ChatService + ChatController** (5.1) — SSE streaming + assess endpoint
6. **ChatMessageResponse DTO** — new response record
7. Verify: `./gradlew compileJava && ./gradlew test`

### Batch 3: Integration
8. Compile all, run full test suite
9. Update phase5_plan.md with completion status

---

## Test Strategy

| Test Class | Tests | Type |
|-----------|-------|------|
| MarketDataServiceTest | 5 | Unit (mock RestClient + Redis) |
| PortfolioServiceTest | 8 | Unit (mock repositories) |
| MarketDataControllerTest | 4 | Unit (mock MarketDataService) |
| ChatServiceTest | 4 | Unit (mock RiskAgentService + repo) |
| Total | **21** | All unit tests |
