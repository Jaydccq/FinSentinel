import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TradingMode, Contract } from '@finsentinel/shared';
import type { IBroker } from './interfaces/broker';
import { PaperBroker } from './brokers/paper.broker';
import { AlpacaBroker } from './brokers/alpaca.broker';
import { OkxBroker } from './brokers/okx.broker';
import { CcxtBroker } from './brokers/ccxt.broker';
import { PaperTradingEngine } from './engines/paper-trading.engine';
import { AlpacaTradingEngine } from './engines/alpaca-trading.engine';
import { MarketDataService } from '../market/market-data.service';
import { alpacaConfig } from '../config/alpaca.config';
import type { OkxTradingEngine } from '../okx/okx-trading.engine';

/**
 * BrokerRegistry — resolves the correct IBroker for a given Contract + TradingMode.
 *
 * Broker registry and router:
 * - PAPER mode: always returns a fresh PaperBroker wrapping a new PaperTradingEngine
 * - LIVE mode: iterates cached live brokers, returns first that canHandle(contract)
 *
 * Live brokers are built lazily and cached. Priority order: Alpaca > OKX > CCXT.
 */
@Injectable()
export class BrokerRegistry {
  private readonly logger = new Logger(BrokerRegistry.name);
  private cachedLiveBrokers: IBroker[] | null = null;

  constructor(
    private readonly marketDataService: MarketDataService,
    @Inject(alpacaConfig.KEY) private readonly alpacaCfg: ConfigType<typeof alpacaConfig>,
    @Optional() @Inject('OKX_TRADING_ENGINE') private readonly okxEngine: OkxTradingEngine | null,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Resolve a broker for the given contract and trading mode.
   *
   * @param contract - The instrument contract to trade
   * @param mode - PAPER or LIVE
   * @param initialCash - Starting cash for paper trading
   * @returns An IBroker that can handle the contract
   * @throws Error if no live broker can handle the contract
   */
  resolve(contract: Contract, mode: TradingMode, initialCash: number): IBroker {
    if (mode === TradingMode.PAPER) {
      return new PaperBroker(new PaperTradingEngine(this.marketDataService, initialCash));
    }

    // LIVE mode: find first broker that can handle the contract
    const liveBrokers = this.getLiveBrokers();
    for (const broker of liveBrokers) {
      if (broker.canHandle(contract)) {
        return broker;
      }
    }

    throw new Error(`No live broker can handle ${contract.displayName()}`);
  }

  /**
   * List all available brokers for the given mode.
   * Always includes a PaperBroker. In LIVE mode, also includes enabled live brokers.
   */
  listAvailableBrokers(mode: TradingMode, initialCash: number): IBroker[] {
    const list: IBroker[] = [];

    // Paper broker is always available
    list.push(new PaperBroker(new PaperTradingEngine(this.marketDataService, initialCash)));

    // Add live brokers in LIVE mode
    if (mode === TradingMode.LIVE) {
      list.push(...this.getLiveBrokers());
    }

    return list;
  }

  // ── Private ────────────────────────────────────────────────────────────

  private getLiveBrokers(): IBroker[] {
    if (this.cachedLiveBrokers === null) {
      this.cachedLiveBrokers = this.buildLiveBrokers();
    }
    return this.cachedLiveBrokers;
  }

  /**
   * Build the list of enabled live brokers.
   * Priority: Alpaca > OKX > CCXT
   */
  private buildLiveBrokers(): IBroker[] {
    const brokers: IBroker[] = [];

    // ── Alpaca (US equities) ────────────────────────────────────────────
    if (this.alpacaCfg.enabled && this.alpacaCfg.apiKey && this.alpacaCfg.secretKey) {
      const engine = new AlpacaTradingEngine(
        this.alpacaCfg.apiKey,
        this.alpacaCfg.secretKey,
        this.alpacaCfg.baseUrl,
      );
      brokers.push(new AlpacaBroker(engine));
      this.logger.log('Alpaca broker registered (US equities)');
    }

    // ── OKX (crypto derivatives) ────────────────────────────────────────
    if (this.okxEngine) {
      brokers.push(new OkxBroker(this.okxEngine));
      this.logger.log('OKX broker registered (crypto derivatives)');
    }

    // ── CCXT (crypto spot) ──────────────────────────────────────────────
    // CCXT requires runtime exchange instantiation which depends on the
    // ccxt library. Register when a CcxtTradingEngine is provided via DI.
    // For now, CCXT is not auto-registered; it can be added when
    // a CCXT_TRADING_ENGINE injection token is provided by a future module.

    if (brokers.length === 0) {
      this.logger.warn(
        'No live brokers registered. LIVE trading mode will fail. ' +
          'Enable Alpaca (ALPACA_ENABLED=true) or OKX (APP_OKX_ENABLED=true) with valid credentials.',
      );
    }

    return Object.freeze([...brokers]) as IBroker[];
  }
}
