package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.okx.OkxApiClient;
import com.example.finsentinel.service.okx.dto.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class OkxTradingToolTest {

    private OkxApiClient okxApiClient;
    private OkxTradingTool tool;

    @BeforeEach
    void setUp() {
        okxApiClient = mock(OkxApiClient.class);
        tool = new OkxTradingTool(okxApiClient);
    }

    private OkxPosition pos(String instId, String posSide, String size, String avgPx,
                             String markPx, String liqPx, String upl, String lever) {
        return new OkxPosition(instId, "SWAP", posSide, size, avgPx, markPx, liqPx,
                upl, null, lever, "cross", null, null, null, null, null, null, null);
    }

    @Test
    void analyzeOkxPosition_singlePosition_showsAllFields() {
        OkxPosition position = pos("BTC-USDT-SWAP", "long", "1", "65000", "67000", "55000", "2000", "10");
        when(okxApiClient.getPositions()).thenReturn(new OkxResponse<>("0", "", List.of(position)));
        // Mock ticker/funding as empty to focus on position logic
        when(okxApiClient.getFundingRate("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));
        when(okxApiClient.getTicker("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));

        String result = tool.analyzeOkxPosition("btc-usdt-swap");

        assertThat(result).contains("Position Analysis: BTC-USDT-SWAP");
        assertThat(result).contains("Side:             long");
        assertThat(result).contains("Leverage:         10x");
        assertThat(result).contains("Liq Distance:");
    }

    @Test
    void analyzeOkxPosition_hedgeMode_showsBothLegs() {
        OkxPosition longLeg = pos("BTC-USDT-SWAP", "long", "2", "65000", "67000", "55000", "4000", "10");
        OkxPosition shortLeg = pos("BTC-USDT-SWAP", "short", "-1", "68000", "67000", "80000", "1000", "5");

        when(okxApiClient.getPositions()).thenReturn(new OkxResponse<>("0", "", List.of(longLeg, shortLeg)));
        when(okxApiClient.getFundingRate("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));
        when(okxApiClient.getTicker("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));

        String result = tool.analyzeOkxPosition("BTC-USDT-SWAP");

        assertThat(result).contains("2 position legs (hedge mode)");
        assertThat(result).contains("Position Leg 1 (long)");
        assertThat(result).contains("Position Leg 2 (short)");
        assertThat(result).contains("Leverage:         10x");
        assertThat(result).contains("Leverage:         5x");
    }

    @Test
    void analyzeOkxPosition_noMatchingPosition_showsNotFound() {
        OkxPosition other = pos("ETH-USDT-SWAP", "long", "5", "3000", "3100", "2500", "500", "3");
        when(okxApiClient.getPositions()).thenReturn(new OkxResponse<>("0", "", List.of(other)));
        when(okxApiClient.getTicker("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));
        when(okxApiClient.getFundingRate("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));

        String result = tool.analyzeOkxPosition("BTC-USDT-SWAP");

        assertThat(result).contains("No open position found for BTC-USDT-SWAP");
    }

    @Test
    void analyzeOkxPosition_apiFailure_showsError() {
        when(okxApiClient.getPositions()).thenThrow(new RuntimeException("Connection refused"));
        when(okxApiClient.getTicker("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));
        when(okxApiClient.getFundingRate("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));

        String result = tool.analyzeOkxPosition("BTC-USDT-SWAP");

        assertThat(result).contains("Could not fetch position data: Connection refused");
    }

    @Test
    void analyzeOkxPosition_lowLiquidationDistance_showsWarning() {
        // markPx=67000, liqPx=64000 => distance ~4.48% < 5% => warning
        OkxPosition position = pos("BTC-USDT-SWAP", "long", "1", "65000", "67000", "64000", "2000", "20");
        when(okxApiClient.getPositions()).thenReturn(new OkxResponse<>("0", "", List.of(position)));
        when(okxApiClient.getFundingRate("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));
        when(okxApiClient.getTicker("BTC-USDT-SWAP")).thenReturn(new OkxResponse<>("0", "", List.of()));

        String result = tool.analyzeOkxPosition("BTC-USDT-SWAP");

        assertThat(result).contains("WARNING: Liquidation distance < 5%");
    }
}
