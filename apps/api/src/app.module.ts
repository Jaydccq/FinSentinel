import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule, DatabaseModule } from './config';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { MarketModule } from './market/market.module';
import { AgentModule } from './agent/agent.module';
import { TradingModule } from './trading/trading.module';
import { EventsModule } from './events/events.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { ChatModule } from './chat/chat.module';
import { NewsModule } from './news/news.module';
import { RagModule } from './rag/rag.module';
import { AutonomyModule } from './autonomy/autonomy.module';
import { StorageModule } from './storage/storage.module';
import { DocumentModule } from './document/document.module';
import { OpenbbModule } from './openbb/openbb.module';
import { OkxModule } from './okx/okx.module';
import { QueueModule } from './queue/queue.module';
import { AnalysisModule } from './analysis/analysis.module';
import { ResearchModule } from './research/research.module';
import { ScraperModule } from './scraper/scraper.module';
import { ReportModule } from './report/report.module';
import { McpModule } from './mcp/mcp.module';
import { WatchlistModule } from './watchlist/watchlist.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    ScheduleModule.forRoot(),
    // F-12 (2026-04-24): structured JSON logging via pino. In dev, pipe
    // through pino-pretty for human-readable output; in prod emit JSON
    // so Loki/DataDog can index fields directly. nestjs-pino wraps the
    // @nestjs/common Logger interface, so existing `new Logger(X.name)`
    // call sites keep working — just with JSON-shaped output.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? 'info',
        // Pulled from the X-Request-ID middleware so every log line
        // carries the same ID as the response header.
        customProps: (req) => ({
          requestId: (req as { id?: string }).id,
        }),
        transport:
          process.env['NODE_ENV'] === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,req,res,responseTime',
                },
              },
        // Drop noisy health-check access logs. Keep everything else.
        autoLogging: {
          ignore: (req) => (req.url ?? '').startsWith('/api/health'),
        },
      },
    }),
    AuthModule,
    CommonModule,
    MarketModule,
    AgentModule,
    TradingModule,
    EventsModule,
    PortfolioModule,
    ChatModule,
    NewsModule,
    RagModule,
    AutonomyModule,
    StorageModule,
    DocumentModule,
    // OpenBB is always imported; its service guards at method level via config.enabled.
    OpenbbModule,
    // OKX is always imported; guards at service level via config.enabled.
    OkxModule,
    // BullMQ queues for async document vectorization and news enrichment.
    QueueModule,
    // AI-powered stock analysis with SSE streaming.
    AnalysisModule,
    // Company research and equity screener.
    ResearchModule,
    // Web scrapers for SEC, Investopedia, Polygon.
    ScraperModule,
    // Risk report generation and PDF export.
    ReportModule,
    // MCP server for Claude Desktop integration; guards at controller level via McpApiKeyGuard.
    McpModule,
    // Watchlist — exposes GET/POST /watchlist backed by WatchlistService.
    WatchlistModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
