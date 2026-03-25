package com.example.finsentinel.dto.trading;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UnifiedStageRequest(
    @NotBlank @Pattern(regexp = "^(BUY|SELL|CLOSE)$") String action,
    @NotBlank @Size(max = 50, message = "Symbol must be at most 50 characters") String symbol,
    @Size(max = 30) String qty,
    @Size(max = 30) String amount,
    @Size(max = 30) String price
) {}
