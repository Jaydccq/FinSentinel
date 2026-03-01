package com.example.finsentinel.service.okx.dto;

import java.util.List;

/**
 * Generic wrapper for all OKX v5 API responses.
 *
 * <p>OKX returns {@code "0"} for success and non-zero codes for errors.
 * The {@code data} array contains the typed payload(s).
 */
public record OkxResponse<T>(String code, String msg, List<T> data) {
    public boolean isSuccess() {
        return "0".equals(code);
    }
}
