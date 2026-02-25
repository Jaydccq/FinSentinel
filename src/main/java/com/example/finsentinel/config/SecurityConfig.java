package com.example.finsentinel.config;

import com.example.finsentinel.security.JwtAuthenticationFilter;
import com.example.finsentinel.security.McpApiKeyAuthFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * Configures Spring Security for the application.
 *
 * <p>This configuration enables stateless JWT authentication, defines CORS policy
 * for local frontend hosts, and registers core authentication beans used by the
 * auth and protected API flows.
 */

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    /**
     * MCP server security filter chain — API-key auth for {@code /mcp/**} paths.
     *
     * <p>Evaluated before the default JWT chain ({@link Order @Order(1)} vs
     * {@link Order @Order(2)}). Only active when {@code app.mcp.enabled=true}.
     */
    @Bean
    @Order(1)
    @ConditionalOnProperty(name = "app.mcp.enabled", havingValue = "true")
    public SecurityFilterChain mcpSecurityFilterChain(HttpSecurity http,
                                                      McpServerProperties mcpServerProperties) throws Exception {
        http
                .securityMatcher("/mcp/**")
                .csrf(csrf -> csrf.disable())
                .cors(cors -> cors.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint((request, response, authException) ->
                                response.sendError(jakarta.servlet.http.HttpServletResponse.SC_UNAUTHORIZED,
                                        "Unauthorized"))
                )
                .addFilterBefore(new McpApiKeyAuthFilter(mcpServerProperties),
                        UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    /**
     * Builds the HTTP security filter chain for API endpoints.
     *
     * <p>The chain disables CSRF for stateless APIs, enables CORS with the
     * configured source, permits authentication and actuator routes, requires
     * authentication for all other routes, and installs the JWT filter before
     * the username/password authentication filter.
     *
     * @param http shared {@link HttpSecurity} builder
     * @return the configured {@link SecurityFilterChain}
     * @throws Exception if Spring Security fails to build the filter chain
     */

    @Bean
    @Order(2)
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/auth/**").permitAll()
                        .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                        .requestMatchers("/actuator/**").authenticated()
                        .anyRequest().authenticated()
                )
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint((request, response, authException) ->
                                response.sendError(jakarta.servlet.http.HttpServletResponse.SC_UNAUTHORIZED,
                                        "Unauthorized"))
                )
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);


        return http.build();
    }


    /**
     * Defines the CORS policy applied to all request paths.
     *
     * @return a CORS configuration source allowing local frontend origins and
     *         standard HTTP methods
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(List.of("http://localhost:5173", "http://localhost:3000"));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }


    /**
     * Exposes the framework-managed {@link AuthenticationManager} bean.
     *
     * @param config authentication configuration provided by Spring Boot
     * @return the resolved {@link AuthenticationManager}
     * @throws Exception if the authentication manager cannot be created
     */
    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {

        return config.getAuthenticationManager();
    }

    /**
     * Provides the password encoder used for user credential hashing.
     *
     * @return a {@link BCryptPasswordEncoder} instance
     */
    @Bean
    public PasswordEncoder passwordEncoder() {

        return new BCryptPasswordEncoder();
    }
}
