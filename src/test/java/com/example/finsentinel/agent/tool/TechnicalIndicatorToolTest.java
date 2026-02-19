package com.example.finsentinel.agent.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Implements AI agent logic for technical indicator tool test workflows.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */

class TechnicalIndicatorToolTest {

    private TechnicalIndicatorTool tool;
    private ObjectMapper objectMapper;

    private static final String SAMPLE_BARS = """
        [
            {"o":170.0,"h":172.0,"l":169.0,"c":171.5,"v":50000000,"t":1706745600000},
            {"o":171.5,"h":173.0,"l":170.5,"c":172.0,"v":48000000,"t":1706832000000},
            {"o":172.0,"h":174.5,"l":171.0,"c":173.5,"v":52000000,"t":1706918400000},
            {"o":173.5,"h":175.0,"l":172.0,"c":174.0,"v":47000000,"t":1707004800000},
            {"o":174.0,"h":176.0,"l":173.5,"c":175.5,"v":55000000,"t":1707091200000},
            {"o":175.5,"h":177.0,"l":174.0,"c":176.0,"v":51000000,"t":1707177600000},
            {"o":176.0,"h":178.0,"l":175.0,"c":177.5,"v":49000000,"t":1707264000000},
            {"o":177.5,"h":179.0,"l":176.5,"c":178.0,"v":53000000,"t":1707350400000},
            {"o":178.0,"h":180.0,"l":177.0,"c":179.0,"v":56000000,"t":1707436800000},
            {"o":179.0,"h":180.5,"l":177.5,"c":178.5,"v":48000000,"t":1707523200000},
            {"o":178.5,"h":179.5,"l":177.0,"c":178.0,"v":45000000,"t":1707609600000},
            {"o":178.0,"h":179.0,"l":176.5,"c":177.0,"v":44000000,"t":1707696000000},
            {"o":177.0,"h":178.5,"l":176.0,"c":177.5,"v":46000000,"t":1707782400000},
            {"o":177.5,"h":179.0,"l":176.5,"c":178.5,"v":50000000,"t":1707868800000},
            {"o":178.5,"h":180.0,"l":177.5,"c":179.5,"v":52000000,"t":1707955200000},
            {"o":179.5,"h":181.0,"l":178.5,"c":180.0,"v":54000000,"t":1708041600000},
            {"o":180.0,"h":182.0,"l":179.0,"c":181.5,"v":57000000,"t":1708128000000},
            {"o":181.5,"h":183.0,"l":180.5,"c":182.0,"v":55000000,"t":1708214400000},
            {"o":182.0,"h":183.5,"l":181.0,"c":182.5,"v":51000000,"t":1708300800000},
            {"o":182.5,"h":184.0,"l":181.5,"c":183.0,"v":53000000,"t":1708387200000},
            {"o":183.0,"h":184.5,"l":182.0,"c":183.5,"v":49000000,"t":1708473600000},
            {"o":183.5,"h":185.0,"l":182.5,"c":184.0,"v":56000000,"t":1708560000000},
            {"o":184.0,"h":185.5,"l":183.0,"c":184.5,"v":52000000,"t":1708646400000},
            {"o":184.5,"h":186.0,"l":183.5,"c":185.0,"v":54000000,"t":1708732800000},
            {"o":185.0,"h":186.5,"l":184.0,"c":185.5,"v":50000000,"t":1708819200000},
            {"o":185.5,"h":187.0,"l":184.5,"c":186.0,"v":55000000,"t":1708905600000},
            {"o":186.0,"h":187.5,"l":185.0,"c":186.5,"v":53000000,"t":1708992000000},
            {"o":186.5,"h":188.0,"l":185.5,"c":187.0,"v":57000000,"t":1709078400000},
            {"o":187.0,"h":188.5,"l":186.0,"c":187.5,"v":51000000,"t":1709164800000},
            {"o":187.5,"h":189.0,"l":186.5,"c":188.0,"v":54000000,"t":1709251200000}
        ]
        """;


    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        tool = new TechnicalIndicatorTool(objectMapper);
    }


    @Test
    void calculateRSI_shouldReturnValidValue() {
        String result = tool.calculateRSI(SAMPLE_BARS, 14);
        assertThat(result).contains("RSI");
        assertThat(result).doesNotContain("Error");
    }


    @Test
    void calculateMACD_shouldReturnSignalAndHistogram() {
        // Use smaller periods that fit within 30 bars (12+9=21 < 30)
        String result = tool.calculateMACD(SAMPLE_BARS, 8, 12, 9);
        assertThat(result).contains("MACD");
        assertThat(result).contains("Signal Line");
        assertThat(result).contains("Histogram");
        assertThat(result).doesNotContain("Error");
        assertThat(result).doesNotContain("Insufficient");
    }


    @Test
    void calculateBollingerBands_shouldReturnThreeBands() {
        String result = tool.calculateBollingerBands(SAMPLE_BARS, 20, 2.0);
        assertThat(result).contains("Bollinger");
        assertThat(result).contains("Upper");
        assertThat(result).contains("Middle");
        assertThat(result).contains("Lower");
    }


    @Test
    void calculateRSI_withInsufficientData_shouldReturnError() {
        String shortData = """
            [{"o":170.0,"h":172.0,"l":169.0,"c":171.5,"v":50000000,"t":1706745600000}]
            """;
        String result = tool.calculateRSI(shortData, 14);
        assertThat(result).contains("Insufficient data");
    }
}
