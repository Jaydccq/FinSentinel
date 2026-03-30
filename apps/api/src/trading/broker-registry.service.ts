import { Injectable } from '@nestjs/common';
import { TradingMode, Contract } from '@finsentinel/shared';
import type { IBroker } from './interfaces/broker';
import { PaperBroker } from './brokers/paper.broker';
import { PaperTradingEngine } from './engines/paper-trading.engine';
import type { MarketDataService } from '../market/market-data.service';

/**
 * BrokerRegistry — resolves the correct IBroker for a given Contract + TradingMode.
 *
 * Mirrors the Java BrokerRegistry @Component:
 * - PAPER mode: always returns a fresh PaperBroker wrapping a new PaperTradingEngine
 * - LIVE mode: iterates cached live brokers, returns first that canHandle(contract)
 *
 * Live brokers are built lazily and cached. Priority order: Alpaca > OKX > CCXT.
 * Currently no live brokers are enabled (stubs for future phases).
 */
@Injectable()
export class BrokerRegistry {
  private cachedLiveBrokers: IBroker[] | null = null;

  constructor(private readonly marketDataService: MarketDataService) {}

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
      return new PaperBroker(
        new PaperTradingEngine(this.marketDataService, initialCash),
      );
    }

    // LIVE mode: find first broker that can handle the contract
    const liveBrokers = this.getLiveBrokers();
    for (const broker of liveBrokers) {
      if (broker.canHandle(contract)) {
        return broker;
      }
    }

    throw new Error(
      `No live broker can handle ${contract.displayName()}`,
    );
  }

  /**
   * List all available brokers for the given mode.
   * Always includes a PaperBroker. In LIVE mode, also includes enabled live brokers.
   */
  listAvailableBrokers(mode: TradingMode, initialCash: number): IBroker[] {
    const list: IBroker[] = [];

    // Paper broker is always available
    list.push(
      new PaperBroker(
        new PaperTradingEngine(this.marketDataService, initialCash),
      ),
    );

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
   *
   * TODO: Phase 5.5+ — add AlpacaBroker, OkxBroker, CcxtBroker when ready
   */
  private buildLiveBrokers(): IBroker[] {
    const brokers: IBroker[] = [];

    // TODO: if (alpacaConfig.enabled) brokers.push(new AlpacaBroker(...));
    // TODO: if (okxApiClient != null) brokers.push(new OkxBroker(...));
    // TODO: if (ccxtConfig.enabled) brokers.push(new CcxtBroker(...));

    return Object.freeze([...brokers]) as IBroker[];
  }
}
