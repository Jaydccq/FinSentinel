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
