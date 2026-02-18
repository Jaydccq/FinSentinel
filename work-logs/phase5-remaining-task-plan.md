# Task Plan: Phase 5 Remaining - Rate Limiting & MapStruct Mapping

## Goal
Implement distributed rate limiting (5.5) and MapStruct entity↔DTO mapping (5.6) for FinSentinel.

## Status Summary
- ✅ 5.1 SSE stream chat endpoint — DONE (ChatController + ChatService)
- ✅ 5.2 Portfolio CRUD — DONE (PortfolioController + PortfolioService)
- ✅ 5.3 Market data proxy — DONE (MarketDataController)
- ✅ 5.4 Redis caching with TTL — DONE (MarketDataService: 5min/30min TTL)
- ✅ 5.5 Redis + Lua distributed rate limiting — DONE
- ✅ 5.6 MapStruct entity↔DTO mappers — DONE

---

## Phase 5.5: Rate Limiting

### Task 5.5.1 — Redis + Lua rate limiter component
- [ ] Create `RateLimiterService` in `service/` using Redis + Lua sliding window
- [ ] Lua script: fixed window or token bucket with atomicity
- [ ] Support dimensions: `userId`, `ip`, `endpoint`
- [ ] Return `RateLimitResult` (allowed, remaining, retryAfterMs)

### Task 5.5.2 — `@RateLimit` annotation + AOP
- [ ] Create `@RateLimit` annotation (`limit`, `window`, `key` SpEL, `dimension`)
- [ ] Create `RateLimitAspect` with `@Around` advice
- [ ] Resolve key from SpEL (supports `#user.id`, `#request.remoteAddr`)
- [ ] Throw `RateLimitExceededException` (429) with `Retry-After` header
- [ ] Add exception handler in `GlobalExceptionHandler`

### Task 5.5.3 — Apply to endpoints
- [ ] `POST /api/chat/stream` — 10 req/min per user
- [ ] `POST /api/chat/assess` — 10 req/min per user
- [ ] `GET /api/market/quote/{ticker}` — 30 req/min per user
- [ ] `POST /api/market/batch-quotes` — 10 req/min per user

---

## Phase 5.6: MapStruct Mapping

### Task 5.6.1 — Mapper interface definitions
- [ ] `PortfolioMapper`: `Portfolio → PortfolioResponse`, `PortfolioRequest → Portfolio`
- [ ] `HoldingMapper`: `Holding → HoldingResponse`, `HoldingRequest → Holding`
- [ ] `RiskReportMapper`: `RiskReport (DTO) → RiskReportEntity`, `RiskReportEntity → RiskReport`
- [ ] `DocumentMapper`: `Document → DocumentUploadResponse`

### Task 5.6.2 — Integrate into service layer
- [ ] `PortfolioService`: replace manual `toResponse()` / `toHoldingResponse()` with mappers
- [ ] `ChatController`: replace manual `toResponse(ChatMessage)` with ChatMessage mapper
- [ ] Test mapper output correctness

---

## Key Architecture Decisions
- Rate limit key format: `rl:{dimension}:{identifier}:{endpoint}` in Redis
- Lua script: sliding window counter (INCR + EXPIRE atomically)
- MapStruct uses `@Mapper(componentModel = "spring")` for DI
- `PortfolioMapper` needs `@Mapping(ignore=true)` for entity relations (user, riskReports)

## Files to Create
- `service/RateLimiterService.java`
- `ratelimit/RateLimit.java` (annotation)
- `ratelimit/RateLimitAspect.java`
- `ratelimit/RateLimitExceededException.java`
- `ratelimit/RateLimitResult.java`
- `mapper/PortfolioMapper.java`
- `mapper/HoldingMapper.java`
- `mapper/RiskReportMapper.java`
- `mapper/DocumentMapper.java`
- `resources/lua/rate_limit.lua`

## Files to Modify
- `controller/ChatController.java` — add @RateLimit
- `controller/MarketDataController.java` — add @RateLimit
- `controller/GlobalExceptionHandler.java` — add 429 handler
- `service/PortfolioService.java` — use mappers
- `service/ChatService.java` (optional mapper for ChatMessage)

## Status
**Currently in Phase: PLANNING** — ready to begin 5.5.1
