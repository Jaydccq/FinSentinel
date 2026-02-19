package com.example.finsentinel.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;

/**
 * Defines configuration beans for redis config related components.
 *
 * <p>This class is part of the config layer in FinSentinel.
 */

@Configuration
public class RedisConfig {

    /**
     * Executes redis template.
     *
     * <p>This method belongs to {@link RedisConfig} and encapsulates the
     * redis template workflow.
     * @param connectionFactory connection factory (RedisConnectionFactory)
     * @return the redis template result (RedisTemplate<String, Object>)
     */

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new Jackson2JsonRedisSerializer<>(Object.class));
        template.setHashKeySerializer(new StringRedisSerializer());
        template.setHashValueSerializer(new Jackson2JsonRedisSerializer<>(Object.class));
        template.afterPropertiesSet();
        return template;
    }
}
