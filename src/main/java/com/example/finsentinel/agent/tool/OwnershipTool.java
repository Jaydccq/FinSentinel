package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.market.OwnershipDataService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
public class OwnershipTool {

    private final OwnershipDataService ownershipService;

    @Tool(description = "Get institutional holders for a stock (13F filings). "
            + "Shows top institutional investors, number of shares held, and portfolio weight. "
            + "Use to assess institutional confidence and potential large block moves.")
    public String getInstitutionalHolders(
            @ToolParam(description = "Stock ticker symbol, e.g. AAPL") String ticker) {
        return ownershipService.getInstitutionalHolders(ticker);
    }

    @Tool(description = "Get insider trading activity for a stock (SEC Form 4 filings). "
            + "Shows recent insider buys/sells with dates, amounts, and insider roles. "
            + "Use to gauge management sentiment — insider buying is a bullish signal.")
    public String getInsiderTransactions(
            @ToolParam(description = "Stock ticker symbol, e.g. TSLA") String ticker) {
        return ownershipService.getInsiderTransactions(ticker);
    }
}
