package com.example.finsentinel.util;

import java.math.BigDecimal;

public final class NumberUtils {
    private NumberUtils() {}

    public static BigDecimal toBigDecimal(Object value) {
        if (value == null) return BigDecimal.ZERO;
        if (value instanceof BigDecimal bd) return bd;
        if (value instanceof Number n) return new BigDecimal(n.toString());
        return new BigDecimal(value.toString());
    }
}
