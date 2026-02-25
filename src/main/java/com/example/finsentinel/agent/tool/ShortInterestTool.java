package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.market.ShortInterestService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
public class ShortInterestTool {

    private final ShortInterestService shortInterestService;

    @Tool(description = "Get short interest data for a stock — shows short volume, total volume, "
            + "and short ratio. High short interest (>20%) may indicate bearish sentiment or "
            + "potential short squeeze. Data is bi-weekly with ~2 week delay.")
    public String getShortInterest(
            @ToolParam(description = "Stock ticker symbol, e.g. GME") String ticker) {
        return shortInterestService.getShortInterest(ticker);
    }

    @Tool(description = "Get fails-to-deliver (FTD) data for a stock from SEC. "
            + "High FTD counts may indicate settlement issues or naked shorting pressure. "
            + "Data is monthly with ~1 month delay.")
    public String getFailsToDeliver(
            @ToolParam(description = "Stock ticker symbol, e.g. AMC") String ticker) {
        return shortInterestService.getFailsToDeliver(ticker);
    }
}
