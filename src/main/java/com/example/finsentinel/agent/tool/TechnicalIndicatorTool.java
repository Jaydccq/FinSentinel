package com.example.finsentinel.agent.tool;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;
import org.ta4j.core.BarSeries;
import org.ta4j.core.BaseBarSeriesBuilder;
import org.ta4j.core.indicators.RSIIndicator;
import org.ta4j.core.indicators.MACDIndicator;
import org.ta4j.core.indicators.EMAIndicator;
import org.ta4j.core.indicators.SMAIndicator;
import org.ta4j.core.indicators.ATRIndicator;
import org.ta4j.core.indicators.StochasticOscillatorKIndicator;
import org.ta4j.core.indicators.adx.ADXIndicator;
import org.ta4j.core.indicators.adx.PlusDIIndicator;
import org.ta4j.core.indicators.adx.MinusDIIndicator;
import org.ta4j.core.indicators.statistics.StandardDeviationIndicator;
import org.ta4j.core.indicators.helpers.ClosePriceIndicator;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/**
 * Implements AI agent logic for technical indicator tool workflows.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */

@Component
@Slf4j
@RequiredArgsConstructor
public class TechnicalIndicatorTool {

    private final ObjectMapper objectMapper;

    @Tool(description = "Calculate RSI (Relative Strength Index) from historical price data. " +
            "RSI > 70 = overbought (bearish signal), RSI < 30 = oversold (bullish signal). " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    /**
     * Calculates rsi.
     *
     * <p>This method is defined in {@link TechnicalIndicatorTool}.
     * @param barsJson bars json (String)
     * @param period period (int)
     * @return the calculate rsi result (String)
     */

    public String calculateRSI(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...]") String barsJson,
            @ToolParam(description = "RSI period, typically 14") int period) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < period + 1) {

                return "Insufficient data: need at least " + (period + 1) + " bars, got " + series.getBarCount();
            }

            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);
            RSIIndicator rsi = new RSIIndicator(closePrice, period);

            int lastIndex = series.getEndIndex();
            double rsiValue = rsi.getValue(lastIndex).doubleValue();

            String signal;
            if (rsiValue > 70) signal = "OVERBOUGHT (bearish — potential reversal down)";
            else if (rsiValue > 60) signal = "MODERATELY BULLISH";
            else if (rsiValue > 40) signal = "NEUTRAL";
            else if (rsiValue > 30) signal = "MODERATELY BEARISH";
            else signal = "OVERSOLD (bullish — potential reversal up)";


            return String.format("""
                    RSI(%d) Analysis:
                    - Current RSI: %.2f
                    - Signal: %s
                    - Last 5 RSI values: %.1f, %.1f, %.1f, %.1f, %.1f""",
                    period, rsiValue, signal,
                    safeRsi(rsi, lastIndex - 4),
                    safeRsi(rsi, lastIndex - 3),
                    safeRsi(rsi, lastIndex - 2),
                    safeRsi(rsi, lastIndex - 1),
                    rsiValue);

        } catch (Exception e) {
            log.error("RSI calculation failed", e);

            return "Error calculating RSI: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate MACD (Moving Average Convergence Divergence) from historical price data. " +
            "MACD above signal line = bullish, below = bearish. Histogram shows momentum strength. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    /**
     * Calculates macd.
     *
     * <p>This method is defined in {@link TechnicalIndicatorTool}.
     * @param barsJson bars json (String)
     * @param shortPeriod short period (int)
     * @param longPeriod long period (int)
     * @param signalPeriod signal period (int)
     * @return the calculate macd result (String)
     */

    public String calculateMACD(
            @ToolParam(description = "JSON array of price bars") String barsJson,
            @ToolParam(description = "Short EMA period, typically 12") int shortPeriod,
            @ToolParam(description = "Long EMA period, typically 26") int longPeriod,
            @ToolParam(description = "Signal line EMA period, typically 9") int signalPeriod) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < longPeriod + signalPeriod) {

                return "Insufficient data: need at least " + (longPeriod + signalPeriod) + " bars";
            }

            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);
            MACDIndicator macd = new MACDIndicator(closePrice, shortPeriod, longPeriod);
            EMAIndicator signalLine = new EMAIndicator(macd, signalPeriod);

            int lastIndex = series.getEndIndex();
            double macdValue = macd.getValue(lastIndex).doubleValue();
            double signalValue = signalLine.getValue(lastIndex).doubleValue();
            double histogram = macdValue - signalValue;

            String signal;
            if (macdValue > signalValue && histogram > 0) signal = "BULLISH (MACD above signal, positive momentum)";
            else if (macdValue > signalValue) signal = "WEAKLY BULLISH (MACD above signal but momentum fading)";
            else if (macdValue < signalValue && histogram < 0) signal = "BEARISH (MACD below signal, negative momentum)";
            else signal = "WEAKLY BEARISH (MACD below signal but momentum recovering)";


            return String.format("""
                    MACD(%d,%d,%d) Analysis:
                    - MACD Line: %.4f
                    - Signal Line: %.4f
                    - Histogram: %.4f
                    - Signal: %s""",
                    shortPeriod, longPeriod, signalPeriod,
                    macdValue, signalValue, histogram, signal);

        } catch (Exception e) {
            log.error("MACD calculation failed", e);

            return "Error calculating MACD: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate Bollinger Bands from historical price data. " +
            "Price near upper band = potential resistance, near lower band = potential support. " +
            "Band width indicates volatility. Input is JSON array of OHLCV bars.")
    /**
     * Calculates bollinger bands.
     *
     * <p>This method is defined in {@link TechnicalIndicatorTool}.
     * @param barsJson bars json (String)
     * @param period period (int)
     * @param stdDevMultiplier std dev multiplier (double)
     * @return the calculate bollinger bands result (String)
     */

    public String calculateBollingerBands(
            @ToolParam(description = "JSON array of price bars") String barsJson,
            @ToolParam(description = "SMA period, typically 20") int period,
            @ToolParam(description = "Standard deviation multiplier, typically 2.0") double stdDevMultiplier) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < period) {
                return "Insufficient data: need at least " + period + " bars";
            }

            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);
            SMAIndicator sma = new SMAIndicator(closePrice, period);
            StandardDeviationIndicator stdDev = new StandardDeviationIndicator(closePrice, period);

            int lastIndex = series.getEndIndex();
            double middle = sma.getValue(lastIndex).doubleValue();
            double sd = stdDev.getValue(lastIndex).doubleValue();
            double upper = middle + (stdDevMultiplier * sd);
            double lower = middle - (stdDevMultiplier * sd);
            double currentPrice = closePrice.getValue(lastIndex).doubleValue();
            double bandWidth = ((upper - lower) / middle) * 100;

            String position;
            double pctB = (currentPrice - lower) / (upper - lower);
            if (pctB > 0.8) position = "NEAR UPPER BAND (potential resistance / overbought)";
            else if (pctB > 0.5) position = "ABOVE MIDDLE (bullish territory)";
            else if (pctB > 0.2) position = "BELOW MIDDLE (bearish territory)";
            else position = "NEAR LOWER BAND (potential support / oversold)";


            return String.format("""

                    Bollinger Bands(%d, %.1f) Analysis:
                    - Upper Band: $%.2f
                    - Middle Band (SMA): $%.2f
                    - Lower Band: $%.2f
                    - Current Price: $%.2f
                    - %%B (position): %.2f
                    - Band Width: %.2f%%
                    - Volatility: %s
                    - Signal: %s""",
                    period, stdDevMultiplier,
                    upper, middle, lower, currentPrice,
                    pctB, bandWidth,
                    bandWidth > 10 ? "HIGH" : bandWidth > 5 ? "MODERATE" : "LOW",
                    position);

        } catch (Exception e) {
            log.error("Bollinger Bands calculation failed", e);

            return "Error calculating Bollinger Bands: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate EMA (Exponential Moving Average) from historical price data. " +
            "EMA reacts faster to recent price changes than SMA. " +
            "Price above EMA = bullish trend, price below EMA = bearish trend. " +
            "Useful for identifying trend direction and dynamic support/resistance levels. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String calculateEMA(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...]") String barsJson,
            @ToolParam(description = "EMA period (common: 9 for short-term, 21 for medium, 50 or 200 for long-term)") int period) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < period) {
                return "Insufficient data: need at least " + period + " bars, got " + series.getBarCount();
            }

            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);
            EMAIndicator ema = new EMAIndicator(closePrice, period);

            int lastIndex = series.getEndIndex();
            double emaValue = ema.getValue(lastIndex).doubleValue();
            double currentPrice = closePrice.getValue(lastIndex).doubleValue();
            double priceDiffPct = ((currentPrice - emaValue) / emaValue) * 100;

            String trendDirection;
            if (currentPrice > emaValue) {
                trendDirection = "BULLISH (price %.2f%% above EMA)".formatted(priceDiffPct);
            } else if (currentPrice < emaValue) {
                trendDirection = "BEARISH (price %.2f%% below EMA)".formatted(Math.abs(priceDiffPct));
            } else {
                trendDirection = "NEUTRAL (price at EMA)";
            }

            // Collect last 5 EMA values
            double[] last5 = new double[5];
            for (int i = 0; i < 5; i++) {
                int idx = lastIndex - 4 + i;
                last5[i] = idx >= 0 ? ema.getValue(idx).doubleValue() : 0.0;
            }

            // Determine EMA trend direction from last 5 values
            String emaTrend;
            if (last5[4] > last5[0] && last5[4] > last5[2]) {
                emaTrend = "RISING (upward momentum)";
            } else if (last5[4] < last5[0] && last5[4] < last5[2]) {
                emaTrend = "FALLING (downward momentum)";
            } else {
                emaTrend = "FLAT (consolidating)";
            }

            return String.format("""
                    EMA(%d) Analysis:
                    - Current EMA: $%.2f
                    - Current Price: $%.2f
                    - Price vs EMA: %s
                    - EMA Trend: %s
                    - Last 5 EMA values: $%.2f, $%.2f, $%.2f, $%.2f, $%.2f""",
                    period, emaValue, currentPrice, trendDirection, emaTrend,
                    last5[0], last5[1], last5[2], last5[3], last5[4]);

        } catch (Exception e) {
            log.error("EMA calculation failed", e);
            return "Error calculating EMA: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate SMA (Simple Moving Average) from historical price data. " +
            "Price above SMA = uptrend, below SMA = downtrend. " +
            "Also detects Golden Cross (SMA50 crosses above SMA200 = strong bullish) and " +
            "Death Cross (SMA50 crosses below SMA200 = strong bearish) when enough data is available. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String calculateSMA(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...]") String barsJson,
            @ToolParam(description = "SMA period (common: 20, 50, 100, 200)") int period) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < period) {
                return "Insufficient data: need at least " + period + " bars, got " + series.getBarCount();
            }

            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);
            SMAIndicator sma = new SMAIndicator(closePrice, period);

            int lastIndex = series.getEndIndex();
            double smaValue = sma.getValue(lastIndex).doubleValue();
            double currentPrice = closePrice.getValue(lastIndex).doubleValue();
            double priceDiffPct = ((currentPrice - smaValue) / smaValue) * 100;

            String pricePosition;
            if (currentPrice > smaValue) {
                pricePosition = "ABOVE SMA (uptrend, price %.2f%% above)".formatted(priceDiffPct);
            } else if (currentPrice < smaValue) {
                pricePosition = "BELOW SMA (downtrend, price %.2f%% below)".formatted(Math.abs(priceDiffPct));
            } else {
                pricePosition = "AT SMA (neutral)";
            }

            // Golden/Death cross detection if enough data for SMA 50 and SMA 200
            String crossSignal = "N/A (need 200+ bars for cross detection)";
            if (series.getBarCount() >= 201) {
                SMAIndicator sma50 = new SMAIndicator(closePrice, 50);
                SMAIndicator sma200 = new SMAIndicator(closePrice, 200);
                double sma50Current = sma50.getValue(lastIndex).doubleValue();
                double sma200Current = sma200.getValue(lastIndex).doubleValue();
                double sma50Prev = sma50.getValue(lastIndex - 1).doubleValue();
                double sma200Prev = sma200.getValue(lastIndex - 1).doubleValue();

                if (sma50Current > sma200Current && sma50Prev <= sma200Prev) {
                    crossSignal = "GOLDEN CROSS DETECTED (SMA50 crossed above SMA200 — strong bullish signal)";
                } else if (sma50Current < sma200Current && sma50Prev >= sma200Prev) {
                    crossSignal = "DEATH CROSS DETECTED (SMA50 crossed below SMA200 — strong bearish signal)";
                } else if (sma50Current > sma200Current) {
                    crossSignal = "SMA50 above SMA200 (bullish alignment, SMA50=$%.2f, SMA200=$%.2f)".formatted(sma50Current, sma200Current);
                } else {
                    crossSignal = "SMA50 below SMA200 (bearish alignment, SMA50=$%.2f, SMA200=$%.2f)".formatted(sma50Current, sma200Current);
                }
            }

            return String.format("""
                    SMA(%d) Analysis:
                    - Current SMA: $%.2f
                    - Current Price: $%.2f
                    - Price vs SMA: %s
                    - Golden/Death Cross: %s""",
                    period, smaValue, currentPrice, pricePosition, crossSignal);

        } catch (Exception e) {
            log.error("SMA calculation failed", e);
            return "Error calculating SMA: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate ATR (Average True Range) from historical price data. " +
            "ATR measures market volatility — higher ATR means more volatile (riskier) asset. " +
            "ATR as percentage of price provides normalized volatility for cross-asset comparison. " +
            "High ATR = high risk/reward, Low ATR = stable/low risk. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String calculateATR(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...]") String barsJson,
            @ToolParam(description = "ATR period, typically 14") int period) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < period + 1) {
                return "Insufficient data: need at least " + (period + 1) + " bars, got " + series.getBarCount();
            }

            ATRIndicator atr = new ATRIndicator(series, period);
            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);

            int lastIndex = series.getEndIndex();
            double atrValue = atr.getValue(lastIndex).doubleValue();
            double currentPrice = closePrice.getValue(lastIndex).doubleValue();
            double atrPct = (atrValue / currentPrice) * 100;

            String volatilityAssessment;
            if (atrPct > 5.0) {
                volatilityAssessment = "VERY HIGH VOLATILITY (ATR > 5%% of price — significant risk)";
            } else if (atrPct > 3.0) {
                volatilityAssessment = "HIGH VOLATILITY (ATR 3-5%% of price — elevated risk)";
            } else if (atrPct > 1.5) {
                volatilityAssessment = "MODERATE VOLATILITY (ATR 1.5-3%% of price — normal market conditions)";
            } else {
                volatilityAssessment = "LOW VOLATILITY (ATR < 1.5%% of price — stable/low risk)";
            }

            // Collect last 5 ATR values for trend
            double[] last5 = new double[5];
            for (int i = 0; i < 5; i++) {
                int idx = lastIndex - 4 + i;
                last5[i] = idx >= 0 ? atr.getValue(idx).doubleValue() : 0.0;
            }

            String atrTrend;
            if (last5[4] > last5[0] * 1.1) {
                atrTrend = "EXPANDING (volatility increasing — rising risk)";
            } else if (last5[4] < last5[0] * 0.9) {
                atrTrend = "CONTRACTING (volatility decreasing — stabilizing)";
            } else {
                atrTrend = "STABLE (volatility unchanged)";
            }

            return String.format("""
                    ATR(%d) Analysis:
                    - Current ATR: $%.4f
                    - ATR as %% of Price: %.2f%%
                    - Current Price: $%.2f
                    - Volatility Assessment: %s
                    - ATR Trend: %s
                    - Last 5 ATR values: $%.4f, $%.4f, $%.4f, $%.4f, $%.4f""",
                    period, atrValue, atrPct, currentPrice, volatilityAssessment, atrTrend,
                    last5[0], last5[1], last5[2], last5[3], last5[4]);

        } catch (Exception e) {
            log.error("ATR calculation failed", e);
            return "Error calculating ATR: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate Stochastic Oscillator from historical price data. " +
            "Measures momentum by comparing closing price to price range over a period. " +
            "%%K > 80 = overbought (bearish signal), %%K < 20 = oversold (bullish signal). " +
            "%%K crossing above %%D = bullish, %%K crossing below %%D = bearish. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String calculateStochastic(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...]") String barsJson,
            @ToolParam(description = "%%K period (lookback window), typically 14") int kPeriod,
            @ToolParam(description = "%%D period (%%K smoothing), typically 3") int dPeriod) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < kPeriod + dPeriod) {
                return "Insufficient data: need at least " + (kPeriod + dPeriod) + " bars, got " + series.getBarCount();
            }

            StochasticOscillatorKIndicator stochK = new StochasticOscillatorKIndicator(series, kPeriod);
            // %D = SMA of %K over dPeriod (Ta4j 0.16 StochasticOscillatorDIndicator uses fixed 3-period)
            SMAIndicator stochD = new SMAIndicator(stochK, dPeriod);

            int lastIndex = series.getEndIndex();
            double kValue = stochK.getValue(lastIndex).doubleValue();
            double dValue = stochD.getValue(lastIndex).doubleValue();

            // Previous values for crossover detection
            double kPrev = lastIndex > 0 ? stochK.getValue(lastIndex - 1).doubleValue() : kValue;
            double dPrev = lastIndex > 0 ? stochD.getValue(lastIndex - 1).doubleValue() : dValue;

            String zone;
            if (kValue > 80) {
                zone = "OVERBOUGHT (%%K > 80 — potential bearish reversal)";
            } else if (kValue < 20) {
                zone = "OVERSOLD (%%K < 20 — potential bullish reversal)";
            } else {
                zone = "NEUTRAL (%%K in normal range)";
            }

            String crossSignal;
            if (kValue > dValue && kPrev <= dPrev) {
                crossSignal = "BULLISH CROSSOVER (%%K crossed above %%D — buy signal)";
            } else if (kValue < dValue && kPrev >= dPrev) {
                crossSignal = "BEARISH CROSSOVER (%%K crossed below %%D — sell signal)";
            } else if (kValue > dValue) {
                crossSignal = "%%K above %%D (bullish momentum)";
            } else {
                crossSignal = "%%K below %%D (bearish momentum)";
            }

            return String.format("""
                    Stochastic(%d,%d) Analysis:
                    - %%K: %.2f
                    - %%D: %.2f
                    - Zone: %s
                    - Crossover Signal: %s""",
                    kPeriod, dPeriod, kValue, dValue, zone, crossSignal);

        } catch (Exception e) {
            log.error("Stochastic Oscillator calculation failed", e);
            return "Error calculating Stochastic Oscillator: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate ADX (Average Directional Index) from historical price data. " +
            "ADX measures trend strength regardless of direction. " +
            "ADX > 25 = strong trend, ADX < 20 = weak/no trend, ADX > 50 = very strong trend. " +
            "+DI > -DI = bullish trend direction, -DI > +DI = bearish trend direction. " +
            "Useful for risk assessment: strong trends are more predictable. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String calculateADX(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...]") String barsJson,
            @ToolParam(description = "ADX period, typically 14") int period) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < period * 2) {
                return "Insufficient data: need at least " + (period * 2) + " bars, got " + series.getBarCount();
            }

            ADXIndicator adx = new ADXIndicator(series, period);
            PlusDIIndicator plusDI = new PlusDIIndicator(series, period);
            MinusDIIndicator minusDI = new MinusDIIndicator(series, period);

            int lastIndex = series.getEndIndex();
            double adxValue = adx.getValue(lastIndex).doubleValue();
            double plusDIValue = plusDI.getValue(lastIndex).doubleValue();
            double minusDIValue = minusDI.getValue(lastIndex).doubleValue();

            String trendStrength;
            if (adxValue > 50) {
                trendStrength = "VERY STRONG TREND (ADX > 50 — highly directional, trend-following favorable)";
            } else if (adxValue > 25) {
                trendStrength = "STRONG TREND (ADX 25-50 — clear directional movement)";
            } else if (adxValue > 20) {
                trendStrength = "WEAK TREND (ADX 20-25 — trend developing or fading)";
            } else {
                trendStrength = "NO TREND / RANGING (ADX < 20 — sideways market, mean-reversion strategies preferred)";
            }

            String trendDirection;
            if (plusDIValue > minusDIValue) {
                trendDirection = "BULLISH (+DI > -DI — upward directional pressure)";
            } else if (minusDIValue > plusDIValue) {
                trendDirection = "BEARISH (-DI > +DI — downward directional pressure)";
            } else {
                trendDirection = "NEUTRAL (+DI equals -DI — no directional bias)";
            }

            // DI crossover detection
            double plusDIPrev = lastIndex > 0 ? plusDI.getValue(lastIndex - 1).doubleValue() : plusDIValue;
            double minusDIPrev = lastIndex > 0 ? minusDI.getValue(lastIndex - 1).doubleValue() : minusDIValue;
            String diCross = "No crossover";
            if (plusDIValue > minusDIValue && plusDIPrev <= minusDIPrev) {
                diCross = "BULLISH DI CROSSOVER (+DI crossed above -DI — potential buy signal)";
            } else if (minusDIValue > plusDIValue && minusDIPrev <= plusDIPrev) {
                diCross = "BEARISH DI CROSSOVER (-DI crossed above +DI — potential sell signal)";
            }

            return String.format("""
                    ADX(%d) Analysis:
                    - ADX: %.2f
                    - +DI: %.2f
                    - -DI: %.2f
                    - Trend Strength: %s
                    - Trend Direction: %s
                    - DI Crossover: %s""",
                    period, adxValue, plusDIValue, minusDIValue,
                    trendStrength, trendDirection, diCross);

        } catch (Exception e) {
            log.error("ADX calculation failed", e);
            return "Error calculating ADX: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate OBV (On-Balance Volume) from historical price data. " +
            "OBV uses volume flow to predict price changes — volume precedes price. " +
            "Rising OBV + rising price = confirmed uptrend (strong). " +
            "Rising OBV + falling price = accumulation / bullish divergence (potential reversal up). " +
            "Falling OBV + rising price = distribution / bearish divergence (potential reversal down). " +
            "Falling OBV + falling price = confirmed downtrend (weak). " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String calculateOBV(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...]") String barsJson) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < 6) {
                return "Insufficient data: need at least 6 bars, got " + series.getBarCount();
            }

            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);

            // Manually calculate OBV (not available in Ta4j 0.16)
            // OBV = cumulative volume, added on up-close days, subtracted on down-close days
            int lastIndex = series.getEndIndex();
            double[] obvValues = new double[series.getBarCount()];
            obvValues[0] = series.getBar(0).getVolume().doubleValue();
            for (int i = 1; i < series.getBarCount(); i++) {
                double currentClose = series.getBar(i).getClosePrice().doubleValue();
                double prevClose = series.getBar(i - 1).getClosePrice().doubleValue();
                double volume = series.getBar(i).getVolume().doubleValue();
                if (currentClose > prevClose) {
                    obvValues[i] = obvValues[i - 1] + volume;
                } else if (currentClose < prevClose) {
                    obvValues[i] = obvValues[i - 1] - volume;
                } else {
                    obvValues[i] = obvValues[i - 1];
                }
            }

            double obvValue = obvValues[lastIndex];

            // Collect last 5 OBV and price values for trend analysis
            double[] obvLast5 = new double[5];
            double[] priceLast5 = new double[5];
            for (int i = 0; i < 5; i++) {
                int idx = lastIndex - 4 + i;
                obvLast5[i] = idx >= 0 ? obvValues[idx] : 0.0;
                priceLast5[i] = idx >= 0 ? closePrice.getValue(idx).doubleValue() : 0.0;
            }

            // OBV trend (comparing first and last of the 5 values)
            boolean obvRising = obvLast5[4] > obvLast5[0];
            boolean priceRising = priceLast5[4] > priceLast5[0];

            String obvTrend;
            if (obvRising) {
                obvTrend = "RISING (buying pressure increasing)";
            } else {
                obvTrend = "FALLING (selling pressure increasing)";
            }

            String divergenceSignal;
            if (obvRising && priceRising) {
                divergenceSignal = "CONFIRMED UPTREND (rising OBV + rising price — volume supports price advance)";
            } else if (obvRising && !priceRising) {
                divergenceSignal = "BULLISH DIVERGENCE (rising OBV + falling price — accumulation detected, potential reversal up)";
            } else if (!obvRising && priceRising) {
                divergenceSignal = "BEARISH DIVERGENCE (falling OBV + rising price — distribution detected, potential reversal down)";
            } else {
                divergenceSignal = "CONFIRMED DOWNTREND (falling OBV + falling price — volume supports price decline)";
            }

            return String.format("""
                    OBV Analysis:
                    - Current OBV: %.0f
                    - OBV Trend (last 5 bars): %s
                    - Price Trend (last 5 bars): %s
                    - Volume-Price Signal: %s
                    - Last 5 OBV values: %.0f, %.0f, %.0f, %.0f, %.0f""",
                    obvValue, obvTrend,
                    priceRising ? "RISING" : "FALLING",
                    divergenceSignal,
                    obvLast5[0], obvLast5[1], obvLast5[2], obvLast5[3], obvLast5[4]);

        } catch (Exception e) {
            log.error("OBV calculation failed", e);
            return "Error calculating OBV: " + e.getMessage();
        }
    }

    /**
     * Parses bars.
     *
     * <p>This method belongs to {@link TechnicalIndicatorTool} and encapsulates the
     * parse bars workflow.
     * @param barsJson bars json (String)
     * @return the parse bars result (BarSeries)
     * @throws Exception if the operation cannot be completed
     */

    private BarSeries parseBars(String barsJson) throws Exception {
        JsonNode bars = objectMapper.readTree(barsJson);
        BarSeries series = new BaseBarSeriesBuilder().withName("analysis").build();

        for (JsonNode bar : bars) {
            ZonedDateTime time = Instant.ofEpochMilli(bar.get("t").asLong())
                    .atZone(ZoneId.of("America/New_York"));
            series.addBar(Duration.ofDays(1), time,
                    bar.get("o").asDouble(),
                    bar.get("h").asDouble(),
                    bar.get("l").asDouble(),
                    bar.get("c").asDouble(),
                    bar.get("v").asDouble());
        }
        return series;
    }

    /**
     * Executes safe rsi.
     *
     * <p>This method belongs to {@link TechnicalIndicatorTool} and encapsulates the
     * safe rsi workflow.
     * @param rsi rsi (RSIIndicator)
     * @param index index (int)
     * @return the safe rsi result (double)
     */

    private double safeRsi(RSIIndicator rsi, int index) {
        return index >= 0 ? rsi.getValue(index).doubleValue() : 0.0;
    }
}
