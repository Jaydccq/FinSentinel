import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { ReturnStatistics, ValueAtRisk, VolatilityAnalysis } from '@finsentinel/shared';

/**
 * Stateless quantitative analytics service.
 *
 * Provides statistical risk calculations -- return statistics, Value at Risk,
 * and volatility regime analysis -- using pure TypeScript (no external math libs).
 * All methods accept raw closing price arrays and return structured results.
 *
 * Conventions:
 *   - Returns are log returns: ln(price[i] / price[i-1])
 *   - Annualization uses 252 trading days per year
 *   - Risk-free rate is 5% annual (US Treasury proxy)
 */
@Injectable()
export class QuantAnalysisService {
  private readonly logger = new Logger(QuantAnalysisService.name);

  private static readonly TRADING_DAYS_PER_YEAR = 252;
  private static readonly RISK_FREE_RATE = 0.05;
  private static readonly SQRT_252 = Math.sqrt(252);
  private static readonly ROLLING_WINDOW = 20;

  // Z-scores for parametric VaR
  private static readonly Z_95 = 1.645;
  private static readonly Z_99 = 2.326;

  // ── Public Methods ─────────────────────────────────────────────────────

  /**
   * Calculates comprehensive return statistics for a price series.
   *
   * @param closePrices array of daily closing prices (oldest first), minimum 30
   * @returns return statistics including annualized metrics, distribution shape, and drawdown
   * @throws BadRequestException if fewer than 30 prices are provided
   */
  calculateReturnStatistics(closePrices: number[]): ReturnStatistics {
    this.validateMinimumDataPoints(closePrices, 30);

    const returns = this.calculateLogReturns(closePrices);

    const meanReturn = this.mean(returns);
    const sd = this.stddev(returns);

    const annualizedReturn = meanReturn * QuantAnalysisService.TRADING_DAYS_PER_YEAR;
    const annualizedVolatility = sd * QuantAnalysisService.SQRT_252;

    const skewness = this.calculateSkewness(returns, meanReturn, sd);
    const kurtosis = this.calculateExcessKurtosis(returns, meanReturn, sd);
    const maxDrawdown = this.calculateMaxDrawdown(closePrices);

    const sharpeRatio =
      annualizedVolatility === 0
        ? 0
        : (annualizedReturn - QuantAnalysisService.RISK_FREE_RATE) / annualizedVolatility;

    return {
      meanReturn,
      annualizedReturn,
      standardDeviation: sd,
      annualizedVolatility,
      skewness,
      kurtosis,
      maxDrawdown,
      sharpeRatio,
      dataPoints: returns.length,
    };
  }

  /**
   * Calculates parametric Value at Risk and Conditional VaR.
   *
   * @param closePrices array of daily closing prices (oldest first), minimum 30
   * @returns VaR and CVaR at 95% and 99% confidence levels
   * @throws BadRequestException if fewer than 30 prices
   */
  calculateValueAtRisk(closePrices: number[]): ValueAtRisk {
    this.validateMinimumDataPoints(closePrices, 30);

    const returns = this.calculateLogReturns(closePrices);
    const m = this.mean(returns);
    const s = this.stddev(returns);

    const var95 = m - QuantAnalysisService.Z_95 * s;
    const var99 = m - QuantAnalysisService.Z_99 * s;

    // Parametric CVaR under normal distribution:
    // CVaR = mean - stddev * phi(z) / (1 - confidence)
    // phi(z) = exp(-z^2/2) / sqrt(2*pi)
    const phi95 =
      Math.exp((-QuantAnalysisService.Z_95 * QuantAnalysisService.Z_95) / 2) /
      Math.sqrt(2 * Math.PI);
    const phi99 =
      Math.exp((-QuantAnalysisService.Z_99 * QuantAnalysisService.Z_99) / 2) /
      Math.sqrt(2 * Math.PI);

    const cvar95 = m - s * (phi95 / 0.05);
    const cvar99 = m - s * (phi99 / 0.01);

    return { var95, var99, cvar95, cvar99, method: 'parametric' };
  }

  /**
   * Analyzes volatility regime with rolling window decomposition.
   *
   * @param closePrices array of daily closing prices (oldest first), minimum 30
   * @returns volatility analysis with regime classification and rolling trend
   * @throws BadRequestException if fewer than 30 prices
   */
  calculateVolatilityRegime(closePrices: number[]): VolatilityAnalysis {
    this.validateMinimumDataPoints(closePrices, 30);

    const returns = this.calculateLogReturns(closePrices);

    // Full-period historical volatility
    const historicalVolatility = this.stddev(returns) * QuantAnalysisService.SQRT_252;

    // Current volatility: last 20 returns (or all if fewer)
    const recentWindow = Math.min(QuantAnalysisService.ROLLING_WINDOW, returns.length);
    const recentReturns = returns.slice(returns.length - recentWindow);
    const currentVolatility = this.stddev(recentReturns) * QuantAnalysisService.SQRT_252;

    // Rolling 20-day volatility series
    const rollingVolatility = this.calculateRollingVolatility(returns);

    // Volatility percentile: rank current vol within rolling distribution
    const volatilityPercentile = this.calculatePercentile(rollingVolatility, currentVolatility);

    // Regime classification based on annualized volatility
    const regime = this.classifyVolatilityRegime(currentVolatility);

    return {
      currentVolatility,
      historicalVolatility,
      volatilityPercentile,
      regime,
      rollingVolatility,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /** Compute log returns from a closing price series. */
  private calculateLogReturns(closePrices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < closePrices.length; i++) {
      returns.push(Math.log(closePrices[i]! / closePrices[i - 1]!));
    }
    return returns;
  }

  /** Arithmetic mean. */
  private mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, v) => sum + v, 0) / arr.length;
  }

  /** Sample standard deviation (Bessel's correction: N-1). */
  private stddev(arr: number[]): number {
    if (arr.length <= 1) return 0;
    const m = this.mean(arr);
    const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }

  /** Sample skewness (third standardized moment, adjusted). */
  private calculateSkewness(arr: number[], m: number, s: number): number {
    const n = arr.length;
    if (n < 3 || s === 0) return 0;

    const sum3 = arr.reduce((sum, v) => sum + ((v - m) / s) ** 3, 0);
    // Apache Commons Math uses the unbiased estimator:
    // skewness = [n / ((n-1)(n-2))] * sum((x-mean)/std)^3
    return (n / ((n - 1) * (n - 2))) * sum3;
  }

  /** Excess kurtosis (fourth standardized moment - 3, with bias correction). */
  private calculateExcessKurtosis(arr: number[], m: number, s: number): number {
    const n = arr.length;
    if (n < 4 || s === 0) return 0;

    const sum4 = arr.reduce((sum, v) => sum + ((v - m) / s) ** 4, 0);
    // Apache Commons Math excess kurtosis formula:
    // kurtosis = [n(n+1) / ((n-1)(n-2)(n-3))] * sum((x-mean)/std)^4
    //          - 3(n-1)^2 / ((n-2)(n-3))
    const term1 = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum4;
    const term2 = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
    return term1 - term2;
  }

  /**
   * Calculates the maximum peak-to-trough drawdown from a price series.
   * Returns a negative decimal (e.g., -0.25 for a 25% drawdown).
   */
  private calculateMaxDrawdown(closePrices: number[]): number {
    let peak = closePrices[0]!;
    let maxDrawdown = 0;

    for (const price of closePrices) {
      if (price > peak) {
        peak = price;
      }
      const drawdown = (price - peak) / peak;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    return maxDrawdown;
  }

  /** Rolling 20-day annualized volatility. */
  private calculateRollingVolatility(returns: number[]): number[] {
    const window = QuantAnalysisService.ROLLING_WINDOW;

    if (returns.length < window) {
      // Not enough data for rolling window -- return single full-period value
      return [this.stddev(returns) * QuantAnalysisService.SQRT_252];
    }

    const rollingCount = returns.length - window + 1;
    const rolling: number[] = [];

    for (let i = 0; i < rollingCount; i++) {
      const windowSlice = returns.slice(i, i + window);
      rolling.push(this.stddev(windowSlice) * QuantAnalysisService.SQRT_252);
    }
    return rolling;
  }

  /** Rank current volatility within the rolling distribution (0-100). */
  private calculatePercentile(rollingVol: number[], currentVol: number): number {
    if (rollingVol.length === 0) return 50;
    const countBelow = rollingVol.filter((v) => v <= currentVol).length;
    return (countBelow / rollingVol.length) * 100;
  }

  /** Classify annualized volatility into a regime bucket. */
  private classifyVolatilityRegime(annualizedVol: number): string {
    if (annualizedVol < 0.15) return 'LOW';
    if (annualizedVol < 0.25) return 'NORMAL';
    if (annualizedVol < 0.4) return 'HIGH';
    return 'EXTREME';
  }

  /** Validate minimum data points. */
  private validateMinimumDataPoints(prices: number[], minimum: number): void {
    if (!prices || prices.length < minimum) {
      throw new BadRequestException(
        `Insufficient data: need at least ${minimum} price observations, got ${prices?.length ?? 0}`,
      );
    }
  }
}
