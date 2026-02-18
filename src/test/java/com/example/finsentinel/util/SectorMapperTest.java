package com.example.finsentinel.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class SectorMapperTest {

    @ParameterizedTest
    @CsvSource({
        "AAPL, Technology", "MSFT, Technology", "NVDA, Technology",
        "JPM, Financial", "GS, Financial",
        "JNJ, Healthcare", "PFE, Healthcare",
        "TSLA, Automotive",
        "AMZN, Retail", "WMT, Retail",
        "XOM, Energy", "CVX, Energy"
    })
    void fromTicker_shouldReturnCorrectSector(String ticker, String expected) {
        assertThat(SectorMapper.fromTicker(ticker)).isEqualTo(expected);
    }

    @Test
    void fromTicker_shouldReturnNullForUnknownTicker() {
        assertThat(SectorMapper.fromTicker("UNKNOWN")).isNull();
    }

    @Test
    void fromTicker_shouldBeCaseInsensitive() {
        assertThat(SectorMapper.fromTicker("aapl")).isEqualTo("Technology");
    }
}
