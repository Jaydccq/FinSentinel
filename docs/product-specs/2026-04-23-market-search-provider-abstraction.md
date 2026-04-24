# PRD: Market Search 抽象统一与缓存键规范化

日期：2026-04-23
状态：Draft
优先级：P1

## 1. 背景与更正

最初的评审提到 `callYahooSearch()` 里存在 `?q=${...}"esCount=${limit}` 这样的字符串拼接 bug。**经核对，这一点不成立**：`apps/api/src/market/market-data.service.ts:115` 的实际写法是

```ts
const url = `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(query)}&quotesCount=${limit}&newsCount=0`;
```

URL 拼接正确，没有杂引号。

但同一份评审里另外两个观察是真实存在的，本 PRD 仅针对这两点：

1. **行情供应商抽象与搜索路径分裂**：`getQuote()` / `getHistoricalBars()` 走 `MarketDataProviderRegistry`，而 `searchTickers()` 直接硬编码到 Yahoo 端点。
2. **搜索缓存键未规范化**：`market:search:${query}:${limit}` 直接使用原 query，`AAPL`、`aapl`、`" AAPL "` 会落在不同 key 上。

## 2. 当前代码落点

- `apps/api/src/market/market-data.service.ts`
  - 第 49–83 行：`getQuote` / `getHistoricalBars` 走 `this.registry.getDefaultProvider()`
  - 第 88 行：`cacheKey = 'market:search:${query}:${limit}'`（未 trim/lowercase）
  - 第 96 行：`searchTickers` 直接调用 `callYahooSearch()`
  - 第 115 行：实际 URL 字符串
- `apps/api/src/market/market-data-provider.registry.ts`：当前注册的 provider interface 不含 `searchTickers`

## 3. 目标

1. `searchTickers` 与 quote/history 共用同一套 provider 抽象，便于切换/降级。
2. 缓存键基于规范化形式，提升命中率，避免空格/大小写产生的重复请求。
3. 不改变 API 对前端的契约（响应 schema、路径、query 参数）。

## 4. 非目标

- 不实现新的 provider（例如 Alpaca search、Polygon search）。
- 不改变 Yahoo 作为默认搜索源的行为。

## 5. 方案

### 5.1 接口扩展

`MarketDataProvider` 接口新增可选方法：

```ts
searchTickers?(query: string, limit: number): Promise<TickerSearchResult[]>;
```

注册中心提供 `getSearchProvider()`：优先取 default provider 的 `searchTickers`，缺失时 fallback 到一个新的 `YahooSearchProvider`（把现 `callYahooSearch` 抽离出去）。

### 5.2 规范化缓存键

```ts
const normalized = query.trim().toLowerCase();
if (!normalized) return [];
const cacheKey = `market:search:v2:${normalized}:${limit}`;
```

- 引入 `:v2:` 命名空间避免读到旧缓存。
- 拒绝空查询，省去无效缓存。

### 5.3 URL 构造健壮化

虽然当前 URL 没有 bug，但做两件事让以后不容易出错：

- 用 `new URL()` + `searchParams` 构造，禁止字符串模板拼接。
- 增加 ESLint 规则（或 review checklist）禁止 `${`、`?`、`&` 同时出现在同一个字符串字面量中。

## 6. 验收标准

1. `searchTickers` 通过 registry 调用，单测可以注入 fake search provider 并断言被调用。
2. `cacheKey` 单测：三种输入（`AAPL`/`aapl`/`" AAPL "`）映射到同一 key；空字符串不进入下游。
3. URL 构造单测：使用含空格、加号、Unicode 的 query，结果在 `URL.searchParams.get('q')` 还原后等于原值。
4. 端到端：现有前端 ticker 搜索行为无回归。

## 7. 风险

- v2 命名空间切换会让缓存命中率短期下跌；建议在低峰期上线。
- 如果未来某 provider 的 `searchTickers` 不返回 Yahoo 的字段，需要在 registry 层做映射，否则会破坏前端期待。
