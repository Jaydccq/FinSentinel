package com.example.finsentinel.security;

import com.example.finsentinel.config.McpServerProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class McpApiKeyAuthFilterTest {

    private McpServerProperties properties;
    private McpApiKeyAuthFilter filter;
    private FilterChain filterChain;

    @BeforeEach
    void setUp() {
        properties = new McpServerProperties();
        properties.setEnabled(true);
        properties.setApiKey("test-secret-key");
        properties.setUserId("11111111-1111-1111-1111-111111111111");
        filter = new McpApiKeyAuthFilter(properties);
        filterChain = mock(FilterChain.class);
        SecurityContextHolder.clearContext();
    }

    // ── Valid key ─────────────────────────────────────────────────────

    @Test
    void validApiKey_populatesSecurityContext() throws Exception {
        var request = new MockHttpServletRequest("GET", "/mcp/sse");
        request.addHeader("X-API-Key", "test-secret-key");
        var response = new MockHttpServletResponse();

        filter.doFilterInternal(request, response, filterChain);

        verify(filterChain).doFilter(request, response);
        var auth = SecurityContextHolder.getContext().getAuthentication();
        assertThat(auth).isNotNull();
        assertThat(auth.getPrincipal()).isInstanceOf(UserPrincipal.class);
        var principal = (UserPrincipal) auth.getPrincipal();
        assertThat(principal.getUserId().toString()).isEqualTo("11111111-1111-1111-1111-111111111111");
        assertThat(principal.getUsername()).isEqualTo("mcp-client");
    }

    // ── Invalid key ───────────────────────────────────────────────────

    @Test
    void invalidApiKey_returns401() throws Exception {
        var request = new MockHttpServletRequest("GET", "/mcp/sse");
        request.addHeader("X-API-Key", "wrong-key");
        var response = new MockHttpServletResponse();

        filter.doFilterInternal(request, response, filterChain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        verifyNoInteractions(filterChain);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    // ── Missing key ───────────────────────────────────────────────────

    @Test
    void missingApiKey_returns401() throws Exception {
        var request = new MockHttpServletRequest("GET", "/mcp/messages");
        var response = new MockHttpServletResponse();

        filter.doFilterInternal(request, response, filterChain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        verifyNoInteractions(filterChain);
    }

    // ── Empty key header ────────────────────────────────────────────

    @Test
    void emptyApiKeyHeader_returns401() throws Exception {
        var request = new MockHttpServletRequest("GET", "/mcp/sse");
        request.addHeader("X-API-Key", "");
        var response = new MockHttpServletResponse();

        filter.doFilterInternal(request, response, filterChain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        verifyNoInteractions(filterChain);
    }
}
