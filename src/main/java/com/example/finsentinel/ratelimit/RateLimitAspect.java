package com.example.finsentinel.ratelimit;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Method;

/**
 * AOP aspect that intercepts methods annotated with {@link RateLimit} and
 * enforces distributed rate limits via {@link RateLimiterService}.
 * <p>
 * Key resolution priority:
 * <ol>

 *   <li>Authenticated username (preferred — user-level limiting)</li>
 *   <li>Client IP address (fallback for unauthenticated paths)</li>
 * </ol>
 */
@Aspect
@Component
@RequiredArgsConstructor
@Slf4j
public class RateLimitAspect {

    private final RateLimiterService rateLimiterService;

    /**
     * Executes enforce.
     *
     * <p>This method is defined in {@link RateLimitAspect}.
     * @param pjp pjp (ProceedingJoinPoint)
     * @param rateLimit rate limit (RateLimit)
     * @return the enforce result (Object)
     * @throws Throwable if the operation cannot be completed
     */

    @Around("@annotation(rateLimit)")
    public Object enforce(ProceedingJoinPoint pjp, RateLimit rateLimit) throws Throwable {
        String identifier = resolveIdentifier();
        boolean isAuthenticated = isAuthenticated();
        String dimension = isAuthenticated ? "user" : "ip";
        String endpoint = resolveEndpointKey(pjp, rateLimit);

        RateLimitResult result = rateLimiterService.check(
                dimension, identifier, endpoint, rateLimit.windowSecs(), rateLimit.limit());

        if (!result.allowed()) {
            log.warn("Rate limit exceeded for {}:{} on {}", dimension, identifier, endpoint);

            throw new RateLimitExceededException(result.retryAfterMs());
        }


        return pjp.proceed();
    }

    /**
     * Executes resolve identifier.
     *
     * <p>This method belongs to {@link RateLimitAspect} and encapsulates the
     * resolve identifier workflow.
     * @return the resolve identifier result (String)
     */

    private String resolveIdentifier() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal())) {

            return auth.getName();
        }

        return resolveClientIp();
    }

    /**
     * Executes resolve client ip.
     *
     * <p>This method belongs to {@link RateLimitAspect} and encapsulates the
     * resolve client ip workflow.
     * @return the resolve client ip result (String)
     */

    private boolean isAuthenticated() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal());
    }

    private String resolveClientIp() {
        ServletRequestAttributes attrs =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attrs == null) {
            return "unknown";
        }
        HttpServletRequest request = attrs.getRequest();
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            // Take the first (leftmost) IP — the original client address.
            // Proxies append their addresses to the right of the chain.
            String[] ips = forwarded.split(",");
            return ips[0].trim();
        }

        return request.getRemoteAddr();
    }

    /**
     * Executes resolve endpoint key.
     *
     * <p>This method belongs to {@link RateLimitAspect} and encapsulates the
     * resolve endpoint key workflow.
     * @param pjp pjp (ProceedingJoinPoint)
     * @param rateLimit rate limit (RateLimit)
     * @return the resolve endpoint key result (String)
     */

    private String resolveEndpointKey(ProceedingJoinPoint pjp, RateLimit rateLimit) {
        if (!rateLimit.key().isBlank()) {

            return rateLimit.key();
        }
        Method method = ((MethodSignature) pjp.getSignature()).getMethod();
        String className = pjp.getTarget().getClass().getSimpleName()
                .replace("Controller", "").toLowerCase();

        return className + ":" + method.getName();
    }
}
