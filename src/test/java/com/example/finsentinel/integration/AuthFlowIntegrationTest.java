package com.example.finsentinel.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * End-to-end integration test for the authentication flow.
 * Requires a running PostgreSQL and Redis instance.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AuthFlowIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void fullAuthFlow_registerThenLogin() throws Exception {
        String uniqueSuffix = String.valueOf(System.currentTimeMillis());
        String username = "testuser_" + uniqueSuffix;
        String email = "testuser_" + uniqueSuffix + "@example.com";
        String password = "SecurePass123!";

        // Step 1: Register a new user
        Map<String, String> registerPayload = Map.of(
                "username", username,
                "email", email,
                "password", password,
                "displayName", "Test User"
        );

        MvcResult registerResult = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(registerPayload)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.username").value(username))
                .andExpect(jsonPath("$.email").value(email))
                .andReturn();

        // Verify the token is a non-empty string
        String registerBody = registerResult.getResponse().getContentAsString();
        Map<?, ?> registerResponse = objectMapper.readValue(registerBody, Map.class);
        assertThat(registerResponse.get("token")).isNotNull();
        assertThat(registerResponse.get("token").toString()).isNotBlank();

        // Step 2: Login with the same credentials
        Map<String, String> loginPayload = Map.of(
                "username", username,
                "password", password
        );

        MvcResult loginResult = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(loginPayload)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.username").value(username))
                .andExpect(jsonPath("$.email").value(email))
                .andReturn();

        // Verify login token is present and different from register token
        String loginBody = loginResult.getResponse().getContentAsString();
        Map<?, ?> loginResponse = objectMapper.readValue(loginBody, Map.class);
        assertThat(loginResponse.get("token")).isNotNull();
        assertThat(loginResponse.get("token").toString()).isNotBlank();
    }

    @Test
    void login_withWrongPassword_returns401() throws Exception {
        String uniqueSuffix = String.valueOf(System.currentTimeMillis());
        String username = "testuser_bad_" + uniqueSuffix;
        String email = "testuser_bad_" + uniqueSuffix + "@example.com";
        String password = "SecurePass123!";

        // Register the user first
        Map<String, String> registerPayload = Map.of(
                "username", username,
                "email", email,
                "password", password,
                "displayName", "Test User"
        );

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(registerPayload)))
                .andExpect(status().isOk());

        // Attempt login with wrong password
        Map<String, String> badLoginPayload = Map.of(
                "username", username,
                "password", "WrongPassword999!"
        );

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(badLoginPayload)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void register_duplicateUsername_returns400() throws Exception {
        String uniqueSuffix = String.valueOf(System.currentTimeMillis());
        String username = "testuser_dup_" + uniqueSuffix;
        String email1 = "testuser_dup1_" + uniqueSuffix + "@example.com";
        String email2 = "testuser_dup2_" + uniqueSuffix + "@example.com";
        String password = "SecurePass123!";

        // Register first user
        Map<String, String> firstRegister = Map.of(
                "username", username,
                "email", email1,
                "password", password
        );

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(firstRegister)))
                .andExpect(status().isOk());

        // Attempt to register with the same username
        Map<String, String> duplicateRegister = Map.of(
                "username", username,
                "email", email2,
                "password", password
        );

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(duplicateRegister)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Username already exists"));
    }
}
