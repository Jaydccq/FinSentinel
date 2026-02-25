package com.example.finsentinel.security;

import com.example.finsentinel.config.McpServerProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * Authenticates MCP client requests using a static API key.
 *
 * <p>This filter is registered exclusively in the {@code /mcp/**}
 * {@link org.springframework.security.web.SecurityFilterChain}, so no
 * path check is needed here. Validates the {@code X-API-Key} header
 * against the configured key in {@link McpServerProperties} and populates
 * {@link SecurityContextHolder} with a synthetic {@link UserPrincipal} so
 * that {@code SecurityUtils.getCurrentUserId()} works transparently for
 * downstream tool invocations.
 */
@RequiredArgsConstructor
public class McpApiKeyAuthFilter extends OncePerRequestFilter {

    private static final String API_KEY_HEADER = "X-API-Key";

    private final McpServerProperties mcpServerProperties;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String apiKey = request.getHeader(API_KEY_HEADER);

        if (!StringUtils.hasText(apiKey)
                || !apiKey.equals(mcpServerProperties.getApiKey())) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Invalid or missing API key");
            return;
        }

        UserPrincipal principal = new UserPrincipal(
                mcpServerProperties.getUserIdAsUUID(), "mcp-client", "", List.of());

        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());

        SecurityContextHolder.getContext().setAuthentication(authentication);

        filterChain.doFilter(request, response);
    }
}
