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

    @Around("@annotation(rateLimit)")
    public Object enforce(ProceedingJoinPoint pjp, RateLimit rateLimit) throws Throwable {
        String identifier = resolveIdentifier();
        String dimension = identifier.contains(".") ? "ip" : "user";
        String endpoint = resolveEndpointKey(pjp, rateLimit);

        RateLimitResult result = rateLimiterService.check(
                dimension, identifier, endpoint, rateLimit.windowSecs(), rateLimit.limit());

        if (!result.allowed()) {
            log.warn("Rate limit exceeded for {}:{} on {}", dimension, identifier, endpoint);
            throw new RateLimitExceededException(result.retryAfterMs());
        }

        return pjp.proceed();
    }

    private String resolveIdentifier() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal())) {
            return auth.getName();
        }
        return resolveClientIp();
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
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

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
