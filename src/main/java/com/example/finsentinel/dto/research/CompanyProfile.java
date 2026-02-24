package com.example.finsentinel.dto.research;

import java.math.BigDecimal;

/**
 * Company overview data sourced from Polygon.io ticker details API.
 *
 * <p>Includes basic identity (name, sector, industry), market data (market cap,
 * exchange), and descriptive info (homepage, employee count, IPO date).
 *
 * @param ticker      stock ticker symbol (e.g. AAPL)
 * @param name        full company name
 * @param description company business description
 * @param sector      broad sector classification (e.g. "Technology")
 * @param industry    specific industry (e.g. "Consumer Electronics")
 * @param homepageUrl company website URL
 * @param marketCap   total market capitalization in USD
 * @param employeeCount number of full-time employees
 * @param listDate    IPO / listing date (YYYY-MM-DD)
 * @param exchange    primary exchange (e.g. "NASDAQ", "NYSE")
 */
public record CompanyProfile(
        String ticker,
        String name,
        String description,
        String sector,
        String industry,
        String homepageUrl,
        BigDecimal marketCap,
        int employeeCount,
        String listDate,
        String exchange
) {}
