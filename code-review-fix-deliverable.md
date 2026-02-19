# Deliverable: 2026-02-19 Code Review Priority Fixes

## Scope Completed
- P0: IDOR and ownership enforcement
- P1: security defaults and exception sanitization
- P2: failing test baseline repair
- P3: performance optimizations

## P0 Fixes
- Holding operations now verify holding belongs to the requested portfolio before update/delete.
- Chat session history now queries by `sessionId + userId` instead of `sessionId` only.
- Report PDF generation now queries by `reportId + portfolio.userId`.
- Chat assess/stream now verify `portfolioId` ownership when provided.

## P1 Fixes
- Runtime exception handler no longer returns raw internal exception messages.
- SQL seed initialization default changed from always-on to opt-in via env (`SPRING_SQL_INIT_MODE`).
- JWT default secret changed from hardcoded static value to env or random fallback.

## P2 Fixes
- `MarketDataService` Polygon deserialization aligned to `body(JsonNode.class)` to match tests and remove stubbing mismatch.

## P3 Fixes
- Removed blocking `Thread.sleep` from batch quote fetch loop.
- Removed upload-time pre-parse validation to avoid duplicate parsing before async vectorization.

## Test Evidence
- Targeted red/green cycles run for P0/P1/P2/P3 areas.
- Final full regression: `./gradlew test` -> **BUILD SUCCESSFUL**.
