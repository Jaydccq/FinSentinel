package com.example.finsentinel.dto.trading;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record UnifiedStageRequest(
    @NotBlank @Pattern(regexp = "^(BUY|SELL|CLOSE)$") String action,
    @NotBlank String symbol,
    String qty,
    String amount,
    String price
) {}
