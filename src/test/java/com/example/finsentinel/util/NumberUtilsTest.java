package com.example.finsentinel.util;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import static org.assertj.core.api.Assertions.assertThat;

class NumberUtilsTest {
    @Test void nullReturnsZero() { assertThat(NumberUtils.toBigDecimal(null)).isEqualByComparingTo("0"); }
    @Test void bigDecimalPassThrough() { assertThat(NumberUtils.toBigDecimal(new BigDecimal("1.5"))).isEqualByComparingTo("1.5"); }
    @Test void integerConverts() { assertThat(NumberUtils.toBigDecimal(42)).isEqualByComparingTo("42"); }
    @Test void doubleConverts() { assertThat(NumberUtils.toBigDecimal(3.14)).isEqualByComparingTo("3.14"); }
    @Test void stringConverts() { assertThat(NumberUtils.toBigDecimal("99.99")).isEqualByComparingTo("99.99"); }
}
