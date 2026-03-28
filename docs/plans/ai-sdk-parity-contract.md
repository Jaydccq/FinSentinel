# AI SDK Parity Contract: Spring AI to Vercel AI SDK

> **Status:** Normative -- all Phase 4 agent code MUST satisfy the acceptance criteria in this document.
>
> **Source of truth:** Java source code in the Spring Boot backend. Every behavior listed below includes a file path so reviewers can cross-reference.

---

## 1. Behavior Inventory

### 1.1 Advisor Execution Order

**Java behavior:**
`UserContextAdvisor` (order 50) runs BEFORE `QuestionAnswerAdvisor` (default order, ~300).

- `UserContextAdvisor.before()` extracts `userId` from the advisor context, loads the user's investment profile summary via `UserInvestmentProfileService.getProfileSummary(userId)`, and prepends it to the system prompt via `prompt.augmentSystemMessage(profileSummary)`.
- `UserContextAdvisor.after()` is a no-op.
- `QuestionAnswerAdvisor` performs cosine-similarity search against pgvector (topK and threshold from `RagRetrievalProperties`) and injects retrieved document chunks into the prompt.

**Source files:**
- `src/main/java/com/example/finsentinel/agent/advisor/UserContextAdvisor.java` (lines 35, 50-78)
- `src/main/java/com/example/finsentinel/config/RagAdvisorConfig.java`
- `src/main/java/com/example/finsentinel/agent/AgentConfig.java` (line 108)

**Parity requirement:**
Profile injection MUST execute before RAG retrieval. In the TS agent, compose the system prompt as `${profileSummary}\n\n${personaPrompt}` before the RAG step appends retrieved context to the messages array.

**Acceptance tests:**
- `should prepend user profile summary to system prompt when userId is present`
- `should skip profile injection gracefully when userId is missing`
- `should skip profile injection when profile summary is empty or null`
- `should execute profile injection before RAG context injection`
- `should not modify system prompt when UserInvestmentProfileService throws`

---

### 1.2 System Prompt Composition

**Java behavior:**
The persona `.st` template is loaded once at bean creation time from the path `${app.agent.personas-dir}${app.agent.persona}.st` (default: `classpath:prompts/personas/default.st`). At request time, `UserContextAdvisor` prepends the profile summary. The final system prompt delivered to the LLM is:

```
[profile summary text]

[full persona template text]
```

The `augmentSystemMessage()` call prepends, so the profile summary appears first.

**Source files:**
- `src/main/java/com/example/finsentinel/config/PersonaProperties.java` (persona name + directory)
- `src/main/java/com/example/finsentinel/agent/AgentConfig.java` (lines 84-86, 106)
- `src/main/resources/prompts/personas/default.st` (RISEN framework template, ~200 lines)
- `src/main/resources/prompts/personas/conservative.st`
- `src/main/resources/prompts/personas/aggressive.st`

**Parity requirement:**
- Persona templates must be ported as plain-text strings (or template files loaded at startup). No StringTemplate engine needed -- the `.st` files contain no interpolation variables for the system prompt itself.
- System prompt assembly order: `profileSummary + "\n\n" + personaTemplate`.
- Persona selection via `APP_AGENT_PERSONA` environment variable (default: `"default"`).

**Acceptance tests:**
- `should load persona template matching APP_AGENT_PERSONA env var`
- `should default to "default" persona when env var is unset`
- `should compose system prompt as [profile]\n\n[persona] when profile exists`
- `should use persona template alone when no profile is available`

---

### 1.3 Tool Registration

**Java behavior:**
Tools are registered at bean creation time via `ChatClient.builder().defaultTools(tools.toArray())`. The risk agent client gets 16 required tool classes plus up to 3 optional ones gated by `ObjectProvider<T>.getIfAvailable()`:

Required (16): `StockMarketTool`, `NewsAnalysisTool`, `TechnicalIndicatorTool`, `PortfolioAnalysisTool`, `UnifiedTradingTool`, `BrainTool`, `CompanyResearchTool`, `EquityScreenerTool`, `QuantAnalysisTool`, `ThinkingTool`, `UserProfileTool`, `ConfirmationTool`, `AutonomyTool`, `MarketCalendarTool`, `OwnershipTool`, `ShortInterestTool`.

Optional (up to 3): `CryptoNewsTool` (gated by `APP_CRYPTO_NEWS_ENABLED`), `TwitterTool` (gated by `APP_TWITTER_6551_ENABLED`), `CryptoAnalyticsTool` (gated by feature flag).

**Source files:**
- `src/main/java/com/example/finsentinel/agent/AgentConfig.java` (lines 87-107)

**Parity requirement:**
Tools MUST be assembled per-request (not at module init) because user-scoped tools (Trading, Brain, Portfolio, UserProfile, Autonomy, Confirmation) need `userId` from the request context. Optional tools are included only when their feature flag is enabled.

In Vercel AI SDK:
```ts
const tools = {
  ...marketDataTools,        // stateless
  ...technicalTools,         // stateless
  ...tradingTools(userId),   // user-scoped
  ...brainTools(userId),     // user-scoped
  ...(config.cryptoNews.enabled ? cryptoNewsTools : {}),
  ...(config.twitter.enabled ? twitterTools : {}),
  ...(config.cryptoAnalytics.enabled ? cryptoAnalyticsTools : {}),
};
```

**Acceptance tests:**
- `should include all 16 required tool definitions in every risk agent call`
- `should include CryptoNewsTool only when APP_CRYPTO_NEWS_ENABLED is true`
- `should include TwitterTool only when APP_TWITTER_6551_ENABLED is true`
- `should include CryptoAnalyticsTool only when its feature flag is true`
- `should pass userId to user-scoped tools`
- `should not include user-scoped tools in the stock analysis client`

---

### 1.4 Two ChatClient Instances

**Java behavior:**
Two separate `ChatClient` beans exist:

1. **`riskAgentChatClient`** -- full agent with:
   - All 16+ tools
   - Both advisors (`QuestionAnswerAdvisor`, `UserContextAdvisor`)
   - Persona system prompt
   - Used by `RiskAgentService` for `assess()` and `assessStream()`

2. **`stockAnalysisChatClient`** -- lightweight client with:
   - 5 tools only: `StockMarketTool`, `TechnicalIndicatorTool`, `NewsAnalysisTool`, `OwnershipTool`, `ShortInterestTool`
   - Simple system prompt: `"You are FinSentinel, an AI stock analyst. Follow the user's analysis instructions precisely. Output exactly one JSON block when instructed. Never output RiskReport schema."`
   - NO advisors (no profile injection, no RAG)
   - Used by `StockAnalysisService` for `analyzeStream()`

**Source files:**
- `src/main/java/com/example/finsentinel/agent/AgentConfig.java` (lines 58-131)
- `src/main/java/com/example/finsentinel/agent/RiskAgentService.java`
- `src/main/java/com/example/finsentinel/agent/StockAnalysisService.java`

**Parity requirement:**
Maintain strict separation. The stock analysis agent function MUST NOT receive profile injection, RAG context, or the persona system prompt. It gets its own hardcoded system prompt and only the 5 market-data tools.

**Acceptance tests:**
- `should create risk agent with persona prompt, all tools, profile injection, and RAG`
- `should create stock analysis agent with hardcoded prompt and exactly 5 tools`
- `should not inject user profile into stock analysis agent`
- `should not perform RAG retrieval for stock analysis agent`
- `should not include RiskReport output instructions in stock analysis prompt`

---

### 1.5 Structured Output (RiskReport)

**Java behavior:**
The `/api/chat/assess` endpoint returns a structured `RiskReport` JSON object. The LLM is instructed by the persona prompt to output the schema. `RiskAgentService.assess()` calls `.call().content()` (non-streaming) and parses the raw response with Jackson.

Parse strategy (three stages):
1. Direct `objectMapper.readValue(rawResponse, RiskReport.class)`
2. On failure: ask LLM to fix JSON (ephemeral ChatClient, no tools)
3. On failure: return minimal fallback report (`riskScore: 1, riskLevel: "LOW"`)

Schema:
```typescript
interface RiskReport {
  riskScore: number;    // 1-100
  riskLevel: string;    // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  summary: string;      // 2-3 sentence executive summary
  factors: RiskFactor[];
  actionableAdvice: string[];
}

interface RiskFactor {
  category: string;     // MARKET | LIQUIDITY | POLICY | CONCENTRATION | VOLATILITY | MACRO_SENTIMENT | FUNDAMENTAL_QUALITY
  score: number;        // 1-100
  description: string;
}
```

**Source files:**
- `src/main/java/com/example/finsentinel/dto/risk/RiskReport.java`
- `src/main/java/com/example/finsentinel/dto/risk/RiskFactor.java`
- `src/main/java/com/example/finsentinel/agent/RiskAgentService.java` (lines 43-116)

**Parity requirement:**
Use Zod schema from `@finsentinel/shared` with `generateObject()` (Vercel AI SDK) or `Output.object()` for the assess endpoint. The streaming endpoint (`/api/chat/stream`) returns plain text -- do NOT use structured output mode for streaming.

The three-stage parse retry is not needed in Vercel AI SDK because `generateObject()` with a Zod schema handles structured output natively. However, implement the fallback report for cases where `generateObject()` throws.

**Acceptance tests:**
- `should return RiskReport conforming to Zod schema on /api/chat/assess`
- `should return fallback report (riskScore=1, riskLevel="LOW") when LLM output is unparseable`
- `should NOT use structured output mode for streaming endpoint`
- `should include all required fields: riskScore, riskLevel, summary, factors, actionableAdvice`
- `should validate riskScore is between 1 and 100`

---

### 1.6 SSE Chunk Format

**Java behavior:**
`ChatService.streamChat()` sends SSE events through `SseEmitter`:

Normal flow:
```
event: message
data: {"content":"chunk text","sessionId":"uuid-string"}

event: message
data: {"content":"next chunk","sessionId":"uuid-string"}

event: done
data: [DONE]
```

Error:
```
event: error
data: {"message":"An error occurred while processing your request. Please try again."}
```

Truncation (when `fullResponse.length() > 50,000`):
```
event: message
data: {"content":"\n\n[Analysis truncated — output exceeded maximum length. Please try again.]","sessionId":"uuid-string"}

event: done
data: [DONE]
```

**Source files:**
- `src/main/java/com/example/finsentinel/service/ChatService.java` (lines 52-167)

**Parity requirement:**
The TS SSE format MUST match exactly so the existing React frontend (`/frontend`) can consume it without changes. Do NOT use Vercel AI SDK's default `toDataStreamResponse()` format, which uses a different protocol (`0:`, `e:`, `d:` prefixes). Instead, implement a custom `ReadableStream` that emits named SSE events matching the Java format.

**Acceptance tests:**
- `should emit SSE events with event name "message" and data containing {content, sessionId}`
- `should emit final SSE event with name "done" and data "[DONE]"`
- `should emit SSE event with name "error" and data containing {message} on failure`
- `should set Content-Type to text/event-stream`
- `should include sessionId in every message event`
- `should generate a new sessionId (UUID) when none is provided`

---

### 1.7 Confirmation Flow

**Java behavior:**
`ConfirmationTool.getConfirm(action)`:
- If `confirmationProperties.isBlockLiveMode()` is `true` AND the action string contains "live" (case-insensitive): return `"BLOCKED. Action: {action} -- Switching to LIVE trading mode is not permitted..."`.
- Otherwise: return `"APPROVED (auto). Action: {action} -- Trade amount threshold: ${threshold}..."`.

No actual human-in-the-loop -- auto-approves everything except LIVE mode transitions.

Configuration:
- `app.confirmation.block-live-mode` (default: `true`)
- `app.confirmation.trade-amount-threshold` (default: `10000`)

**Source files:**
- `src/main/java/com/example/finsentinel/agent/tool/ConfirmationTool.java`
- `src/main/java/com/example/finsentinel/config/ConfirmationProperties.java`

**Parity requirement:**
Same logic: auto-approve in PAPER mode, block when action contains "live" and `blockLiveMode` is true. Return the same message format strings.

**Acceptance tests:**
- `should auto-approve actions that do not contain "live"`
- `should block actions containing "live" (case-insensitive) when blockLiveMode is true`
- `should include trade amount threshold in approval message`
- `should include the action description in both approved and blocked messages`
- `should allow "live" actions when blockLiveMode is false`

---

### 1.8 Error Handling in Tools

**Java behavior:**
Every `@Tool` method wraps its body in `try/catch(Exception e)` and returns an error string. Tools NEVER throw exceptions to the LLM framework.

Pattern:
```java
@Tool(description = "...")
public String someMethod(...) {
    try {
        // business logic
        return resultString;
    } catch (Exception e) {
        log.error("Failed to ...", e);
        return "Error: " + e.getMessage();
    }
}
```

**Source files:**
- All files in `src/main/java/com/example/finsentinel/agent/tool/` follow this pattern.
- Example: `UnifiedTradingTool.java` (lines 75-80, 94-99, 111-116, 128-130, etc.)

**Parity requirement:**
Every tool's `execute()` function MUST catch all exceptions internally and return an error string. Never let exceptions propagate to `streamText`/`generateText`, as unhandled tool errors may crash the agent loop or produce unexpected behavior.

```typescript
execute: async (params) => {
  try {
    // business logic
    return resultString;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
```

**Acceptance tests:**
- `should return error string (not throw) when tool execution fails`
- `should prefix error returns with "Error: "`
- `should log the error before returning the error string`
- `should never cause the agent loop to crash due to a tool exception`

---

### 1.9 Chat Context Compaction

**Java behavior:**
`ChatContextCompactionService.augmentPrompt(userId, sessionId, userMessage)`:

1. Load up to 100 messages for the session, ordered by `createdAt ASC`.
2. If total messages minus `recentWindow` (default 10) exceeds `thresholdMessages` (default 24), and recompaction is needed (delta >= 4 messages since last compaction):
   - Send old messages to LLM for summarization (via `RiskAgentService.quickChat()`).
   - Store summary in `ChatSessionMemory` entity.
3. Build the augmented prompt:

```
[Conversation Summary]
{summary text from ChatSessionMemory}

[Recent Conversation]
USER: {message 1}
ASSISTANT: {message 2}
...

[Current User Message]
{user message}
```

Configuration (`app.chat.compaction.*`):
- `enabled`: `true` (default)
- `threshold-messages`: `24`
- `recent-window`: `10`
- `max-summary-chars`: `1200`

When compaction is disabled or sessionId is null, `augmentPrompt()` returns the original `userMessage` unchanged.

**Source files:**
- `src/main/java/com/example/finsentinel/service/chat/ChatContextCompactionService.java`
- `src/main/java/com/example/finsentinel/config/ChatCompactionProperties.java`

**Parity requirement:**
Replicate the exact prompt format. The `[Conversation Summary]`, `[Recent Conversation]`, and `[Current User Message]` section headers are consumed by the LLM and MUST be preserved verbatim.

The recompaction delta threshold (4 messages) and the fallback summary behavior (last 12 messages truncated to 100 chars each) must also be preserved.

**Acceptance tests:**
- `should return original message when compaction is disabled`
- `should return original message when sessionId is null`
- `should return original message when session has no history`
- `should build augmented prompt with [Conversation Summary], [Recent Conversation], [Current User Message] sections`
- `should trigger compaction when compactable messages >= thresholdMessages`
- `should not recompact when delta since last compaction < 4 messages`
- `should keep recentWindow (default 10) most recent messages uncompacted`
- `should truncate individual messages to 300 chars in recent conversation`
- `should truncate individual messages to 220 chars in compaction transcript`
- `should use fallback summary (last 12 messages at 100 chars) when LLM summarization fails`
- `should emit CHAT_CONTEXT_COMPACTED event after compaction`

---

### 1.10 Max Stream Length

**Java behavior:**
`ChatService` enforces `MAX_STREAM_CHARS = 50,000`. When the accumulated response length exceeds this:

1. Send a final message chunk: `"\n\n[Analysis truncated — output exceeded maximum length. Please try again.]"` (for stream chat) or `"\n\n[Analysis truncated — output exceeded maximum length.]"` (for stream analysis).
2. Send `done` event with `[DONE]`.
3. Complete the emitter.
4. Throw `StreamTruncatedException` internally to abort the reactive pipeline.

The check is `projectedLength > MAX_STREAM_CHARS` where `projectedLength = fullResponse.length() + chunk.length()`.

**Source files:**
- `src/main/java/com/example/finsentinel/service/ChatService.java` (lines 44, 67-78, 126-137)

**Parity requirement:**
Implement the same 50,000 character limit. Track accumulated response length. When exceeded, emit the truncation message and done event, then abort the stream.

**Acceptance tests:**
- `should truncate stream when accumulated response exceeds 50,000 characters`
- `should send truncation notice as a message event before done event`
- `should send done event after truncation`
- `should not send any more chunks after truncation`
- `should persist the truncated response (not the full unterminated one)`

---

## 2. SSE Format Specification

### 2.1 Event Types

| Event Name | Data Shape | When |
|---|---|---|
| `message` | `{"content": string, "sessionId": string}` | Each text chunk from the LLM |
| `done` | `[DONE]` (literal string, not JSON) | Stream completed successfully |
| `error` | `{"message": string}` | Unrecoverable error during streaming |

### 2.2 Wire Format Example

```
event: message
data: {"content":"Based on my analysis","sessionId":"550e8400-e29b-41d4-a716-446655440000"}

event: message
data: {"content":" of AAPL, the current","sessionId":"550e8400-e29b-41d4-a716-446655440000"}

event: done
data: [DONE]

```

### 2.3 Implementation Notes

- Each `data:` line is a JSON-serialized string (for `message` and `error`) or the literal `[DONE]` (for `done`).
- The `sessionId` is a UUID v4 string. It is generated server-side when not provided by the client.
- The `done` event's data is NOT wrapped in JSON -- it is the raw string `[DONE]`.
- Empty lines between events follow the SSE spec (double newline terminates an event).

### 2.4 Next.js Implementation Pattern

Do NOT use `toDataStreamResponse()` from `ai` package (it uses a proprietary streaming protocol with `0:`, `e:`, `d:` prefixes). Instead:

```typescript
// Pseudocode -- exact implementation in Phase 4.2
return new Response(
  new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sessionId = inputSessionId ?? crypto.randomUUID();

      for await (const chunk of textStream) {
        charCount += chunk.length;
        if (charCount > MAX_STREAM_CHARS) {
          controller.enqueue(encoder.encode(
            `event: message\ndata: ${JSON.stringify({ content: TRUNCATION_MSG, sessionId })}\n\n`
          ));
          controller.enqueue(encoder.encode(`event: done\ndata: [DONE]\n\n`));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(
          `event: message\ndata: ${JSON.stringify({ content: chunk, sessionId })}\n\n`
        ));
      }

      controller.enqueue(encoder.encode(`event: done\ndata: [DONE]\n\n`));
      controller.close();
    }
  }),
  { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } }
);
```

---

## 3. Known Gaps

### 3.1 Advisor Chain Does Not Exist in Vercel AI SDK

**Spring AI:** `BaseAdvisor` interface with ordered `before()`/`after()` hooks forming a chain. Advisors are registered once at bean creation and run on every request.

**Vercel AI SDK:** No advisor abstraction. The closest equivalent is manual prompt composition before calling `streamText()`/`generateText()`.

**Impact:** Medium. The two advisors (UserContext, RAG) are straightforward pre-processing steps.

### 3.2 Tool Registration Is Per-Request in TS (Difference, Not Gap)

**Spring AI:** Tools registered at bean creation time via `defaultTools()`. Tool instances are Spring singletons.

**Vercel AI SDK:** Tools are a `tools` object passed to each `streamText()`/`generateText()` call.

**Impact:** Low. This is actually an advantage -- user-scoped tools (which need `userId`) are easier to wire per-request in TS than in Java where they rely on advisor context injection.

### 3.3 Persona Templates Use StringTemplate Format

**Spring AI:** `.st` files loaded via Spring's `ResourceLoader`. However, the persona templates use no interpolation variables for the system prompt -- they are plain text.

**Vercel AI SDK:** Load as plain text strings. The `risk-assessment.st` template used in `RiskAgentService` DOES use StringTemplate variables (`{userQuery}`, `{portfolioContext}`) but that is a user message template, not the system prompt.

**Impact:** Low. The persona system prompts are static text. The user message template can use simple string interpolation.

### 3.4 Reactive Stream Model Differs

**Spring AI:** Returns `Flux<String>` (Project Reactor). `ChatService` subscribes to the flux and pushes chunks through `SseEmitter`.

**Vercel AI SDK:** `streamText()` returns a `StreamTextResult` with async iterables (`textStream`, `fullStream`).

**Impact:** Low. Both are pull-based async streams. The TS `for await...of` loop over `textStream` maps directly to the Java `doOnNext`/`doOnComplete`/`doOnError` pattern.

### 3.5 Chat History Is Not Managed by the AI SDK

**Spring AI:** Chat messages are persisted to PostgreSQL via `ChatMessageRepository`. History is loaded manually and passed through compaction.

**Vercel AI SDK:** No built-in chat persistence. Messages must be loaded from DB, compacted, and passed as the `messages` array.

**Impact:** None -- Java does this manually too. The TS implementation will use the same pattern via Drizzle ORM.

### 3.6 RiskReport Parse Retry Is Unnecessary

**Spring AI:** No native structured output for the OpenRouter/Gemini model, so the agent relies on prompt-instructed JSON output and manual Jackson parsing with retry.

**Vercel AI SDK:** `generateObject()` with a Zod schema uses the model's structured output mode (or prompt-based with schema validation). Parsing is handled by the SDK.

**Impact:** Positive -- simpler code. Still need the fallback report for edge cases where `generateObject()` throws `NoObjectGeneratedError`.

---

## 4. Workarounds

### 4.1 Advisor Chain -> Manual Prompt Composition

Replace the advisor chain with explicit sequential steps in the agent route handler:

```
1. Load user profile summary from DB (replaces UserContextAdvisor.before())
2. Load persona template
3. Compose system prompt: profileSummary + "\n\n" + personaTemplate
4. Query pgvector for RAG context (replaces QuestionAnswerAdvisor)
5. Inject RAG context into messages array
6. Call streamText() / generateText() with composed system prompt and enriched messages
```

This preserves the execution order guarantee (profile before RAG) while being explicit rather than implicit.

### 4.2 Per-Request Tool Assembly

Build the `tools` object inside the route handler:

```typescript
function buildTools(userId: string, config: AppConfig) {
  return {
    // Stateless tools (no userId needed)
    getStockQuote: stockMarketTool.getStockQuote,
    getHistoricalPrices: stockMarketTool.getHistoricalPrices,
    calculateRSI: technicalIndicatorTool.calculateRSI,
    // ... other stateless tools

    // User-scoped tools (bind userId)
    analyzePortfolio: portfolioAnalysisTool.analyzePortfolio(userId),
    stageOrder: unifiedTradingTool.stageOrder(userId),
    // ... other user-scoped tools

    // Optional tools (feature-flag gated)
    ...(config.cryptoNews.enabled ? { getCryptoNews: cryptoNewsTool.getCryptoNews } : {}),
    ...(config.twitter.enabled ? { searchTweets: twitterTool.searchTweets } : {}),
    ...(config.cryptoAnalytics.enabled ? { getFundingRate: cryptoAnalyticsTool.getFundingRate } : {}),
  };
}
```

### 4.3 Custom SSE Streaming

Do NOT use `toDataStreamResponse()`. Implement a custom `ReadableStream` that emits the exact SSE format from section 2. This ensures frontend compatibility without any client-side changes.

### 4.4 Structured Output for Assess Endpoint

Use `generateObject()` with the `riskReportSchema` Zod schema for the `/api/chat/assess` endpoint. Wrap in try/catch and return the fallback report on failure:

```typescript
try {
  const { object } = await generateObject({
    model,
    system: composedSystemPrompt,
    messages: enrichedMessages,
    tools: buildTools(userId, config),
    schema: riskReportSchema,
  });
  return object;
} catch (error) {
  return FALLBACK_RISK_REPORT;
}
```

### 4.5 User Message Template Interpolation

Replace StringTemplate's `{userQuery}` and `{portfolioContext}` placeholders with template literals:

```typescript
const userMessage = `
Analyze the following query and produce a structured risk report.

User query: ${userQuery}

Additional context:
${portfolioId ? `- Use analyzePortfolio with portfolio ID: ${portfolioId}` : ""}
`.trim();
```

---

## 5. Configuration Mapping

| Java Property | Default | TS Env Var | Notes |
|---|---|---|---|
| `app.agent.persona` | `"default"` | `APP_AGENT_PERSONA` | Persona template selection |
| `app.chat.compaction.enabled` | `true` | `CHAT_COMPACTION_ENABLED` | Toggle compaction |
| `app.chat.compaction.threshold-messages` | `24` | `CHAT_COMPACTION_THRESHOLD` | Messages before compaction triggers |
| `app.chat.compaction.recent-window` | `10` | `CHAT_COMPACTION_RECENT_WINDOW` | Messages kept uncompacted |
| `app.chat.compaction.max-summary-chars` | `1200` | `CHAT_COMPACTION_MAX_SUMMARY_CHARS` | Summary length cap |
| `app.confirmation.block-live-mode` | `true` | `CONFIRMATION_BLOCK_LIVE_MODE` | Block LIVE mode transitions |
| `app.confirmation.trade-amount-threshold` | `10000` | `CONFIRMATION_TRADE_THRESHOLD` | Dollar threshold for confirmation |
| `app.crypto-news.enabled` | `false` | `APP_CRYPTO_NEWS_ENABLED` | CryptoNewsTool feature flag |
| `app.twitter-6551.enabled` | `false` | `APP_TWITTER_6551_ENABLED` | TwitterTool feature flag |
| N/A | `50000` | N/A (hardcoded) | `MAX_STREAM_CHARS` -- hardcoded constant |

---

## 6. Endpoint Mapping

| Java Endpoint | TS Route | Agent Used | Output Mode |
|---|---|---|---|
| `POST /api/chat/stream` | `POST /api/chat/stream` | riskAgent | SSE (custom format) |
| `POST /api/chat/assess` | `POST /api/chat/assess` | riskAgent | JSON (RiskReport via `generateObject`) |
| `POST /api/chat/analyze` | `POST /api/chat/analyze` | stockAnalysis | SSE (custom format) |

---

## 7. Complete Acceptance Test List

The following test descriptions serve as the Phase 4 acceptance gate. All must pass before Phase 4 is considered complete.

### Agent Configuration
1. `should create risk agent with persona prompt, all tools, profile injection, and RAG`
2. `should create stock analysis agent with hardcoded prompt and exactly 5 tools`
3. `should load persona template matching APP_AGENT_PERSONA env var`
4. `should default to "default" persona when env var is unset`

### Profile Injection (UserContextAdvisor parity)
5. `should prepend user profile summary to system prompt when userId is present`
6. `should skip profile injection gracefully when userId is missing`
7. `should skip profile injection when profile summary is empty or null`
8. `should execute profile injection before RAG context injection`
9. `should not modify system prompt when profile service throws`

### RAG Retrieval (QuestionAnswerAdvisor parity)
10. `should query pgvector for relevant documents and inject into messages`
11. `should not perform RAG retrieval for stock analysis agent`

### Tool Registration
12. `should include all 16 required tool definitions in risk agent calls`
13. `should include optional tools only when their feature flag is enabled`
14. `should pass userId to user-scoped tools`
15. `should register exactly 5 tools for stock analysis agent`

### SSE Streaming
16. `should emit SSE events with event name "message" and data containing {content, sessionId}`
17. `should emit final SSE event with name "done" and data "[DONE]"`
18. `should emit SSE event with name "error" and data containing {message} on failure`
19. `should set Content-Type to text/event-stream`
20. `should generate a new sessionId (UUID) when none is provided`

### Structured Output
21. `should return RiskReport conforming to Zod schema on /api/chat/assess`
22. `should return fallback report when LLM output is unparseable`
23. `should NOT use structured output mode for streaming endpoints`

### Stream Truncation
24. `should truncate stream when accumulated response exceeds 50,000 characters`
25. `should send truncation notice as a message event before done event`
26. `should not send any more chunks after truncation`

### Confirmation Flow
27. `should auto-approve actions that do not contain "live"`
28. `should block actions containing "live" (case-insensitive) when blockLiveMode is true`
29. `should include trade amount threshold in approval message`

### Error Handling
30. `should return error string (not throw) when any tool execution fails`
31. `should never cause the agent loop to crash due to a tool exception`

### Chat Context Compaction
32. `should return original message when compaction is disabled`
33. `should build augmented prompt with [Conversation Summary], [Recent Conversation], [Current User Message] sections`
34. `should trigger compaction when compactable messages >= thresholdMessages`
35. `should keep recentWindow most recent messages uncompacted`
36. `should use fallback summary when LLM summarization fails`
37. `should emit CHAT_CONTEXT_COMPACTED event after compaction`

### Two-Client Separation
38. `should not inject user profile into stock analysis agent`
39. `should not include RiskReport output instructions in stock analysis prompt`
40. `should not include trading or brain tools in stock analysis agent`
