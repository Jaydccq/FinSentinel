package com.example.finsentinel.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * End-to-end integration test for the portfolio and holdings flow.
 * Requires a running PostgreSQL and Redis instance.
 */
@SpringBootTest
@AutoConfigureMockMvc
class PortfolioFlowIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private String jwtToken;

    @BeforeEach
    void setUp() throws Exception {
        // Register a fresh user for each test and extract the JWT token
        String uniqueSuffix = String.valueOf(System.currentTimeMillis()) + "_" + Thread.currentThread().getId();
        String username = "portfolio_user_" + uniqueSuffix;
        String email = "portfolio_user_" + uniqueSuffix + "@example.com";

        Map<String, String> registerPayload = Map.of(
                "username", username,
                "email", email,
                "password", "SecurePass123!",
                "displayName", "Portfolio Test User"
        );

        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(registerPayload)))
                .andExpect(status().isOk())
                .andReturn();

        Map<?, ?> authResponse = objectMapper.readValue(
                result.getResponse().getContentAsString(), Map.class);
        jwtToken = authResponse.get("token").toString();
    }

    @Test
    void fullPortfolioFlow_createAddHoldingAndGet() throws Exception {
        // Step 1: Create a portfolio
        Map<String, String> portfolioPayload = Map.of(
                "name", "Tech Growth Fund",
                "description", "High-growth technology stocks"
        );

        MvcResult createResult = mockMvc.perform(post("/api/portfolios")
                        .header("Authorization", "Bearer " + jwtToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(portfolioPayload)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.name").value("Tech Growth Fund"))
                .andExpect(jsonPath("$.description").value("High-growth technology stocks"))
                .andExpect(jsonPath("$.totalValue").value(0))
                .andExpect(jsonPath("$.holdings").isArray())
                .andExpect(jsonPath("$.holdings").isEmpty())
                .andReturn();

        // Extract the portfolio ID
        Map<?, ?> portfolioResponse = objectMapper.readValue(
                createResult.getResponse().getContentAsString(), Map.class);
        String portfolioId = portfolioResponse.get("id").toString();
        assertThat(portfolioId).isNotBlank();

        // Step 2: Add a holding to the portfolio
        Map<String, Object> holdingPayload = Map.of(
                "symbol", "AAPL",
                "companyName", "Apple Inc.",
                "quantity", 10,
                "averageCost", 185.50,
                "sector", "Technology"
        );

        mockMvc.perform(post("/api/portfolios/{id}/holdings", portfolioId)
                        .header("Authorization", "Bearer " + jwtToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(holdingPayload)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.symbol").value("AAPL"))
                .andExpect(jsonPath("$.companyName").value("Apple Inc."))
                .andExpect(jsonPath("$.quantity").isNumber())
                .andExpect(jsonPath("$.averageCost").isNumber())
                .andExpect(jsonPath("$.sector").value("Technology"));

        // Step 3: Get the portfolio and verify holdings are present
        mockMvc.perform(get("/api/portfolios/{id}", portfolioId)
                        .header("Authorization", "Bearer " + jwtToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(portfolioId))
                .andExpect(jsonPath("$.name").value("Tech Growth Fund"))
                .andExpect(jsonPath("$.holdings").isArray())
                .andExpect(jsonPath("$.holdings.length()").value(1))
                .andExpect(jsonPath("$.holdings[0].symbol").value("AAPL"))
                .andExpect(jsonPath("$.holdings[0].companyName").value("Apple Inc."));
    }

    @Test
    void createPortfolio_withoutAuth_returns401() throws Exception {
        Map<String, String> portfolioPayload = Map.of(
                "name", "Unauthorized Portfolio",
                "description", "Should fail"
        );

        mockMvc.perform(post("/api/portfolios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(portfolioPayload)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void getPortfolios_withoutAuth_returns401() throws Exception {
        mockMvc.perform(get("/api/portfolios"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void listPortfolios_returnsOwnedPortfoliosOnly() throws Exception {
        // Create two portfolios for this user
        Map<String, String> portfolio1 = Map.of(
                "name", "Portfolio Alpha",
                "description", "First portfolio"
        );
        Map<String, String> portfolio2 = Map.of(
                "name", "Portfolio Beta",
                "description", "Second portfolio"
        );

        mockMvc.perform(post("/api/portfolios")
                        .header("Authorization", "Bearer " + jwtToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(portfolio1)))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/portfolios")
                        .header("Authorization", "Bearer " + jwtToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(portfolio2)))
                .andExpect(status().isCreated());

        // List portfolios and verify both are returned
        mockMvc.perform(get("/api/portfolios")
                        .header("Authorization", "Bearer " + jwtToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].name").value("Portfolio Alpha"))
                .andExpect(jsonPath("$[1].name").value("Portfolio Beta"));
    }

    @Test
    void addHolding_withoutAuth_returns401() throws Exception {
        Map<String, Object> holdingPayload = Map.of(
                "symbol", "MSFT",
                "companyName", "Microsoft Corporation",
                "quantity", 5,
                "averageCost", 400.00,
                "sector", "Technology"
        );

        // Use a fake UUID — auth should fail before any DB lookup
        mockMvc.perform(post("/api/portfolios/00000000-0000-0000-0000-000000000000/holdings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(holdingPayload)))
                .andExpect(status().isUnauthorized());
    }
}
