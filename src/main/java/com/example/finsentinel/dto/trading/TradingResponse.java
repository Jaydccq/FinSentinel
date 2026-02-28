package com.example.finsentinel.dto.trading;

/**
 * Generic response wrapper for trading operations that return a message string.
 *
 * @param message the operation result message
 */
public record TradingResponse(String message) {}
