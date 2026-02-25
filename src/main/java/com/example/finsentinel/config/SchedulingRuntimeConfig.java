package com.example.finsentinel.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * Runtime task scheduling infrastructure for dynamic cron jobs.
 */
@Configuration
public class SchedulingRuntimeConfig {

    @Bean
    public TaskScheduler autonomyTaskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);
        scheduler.setThreadNamePrefix("autonomy-schedule-");
        scheduler.initialize();
        return scheduler;
    }
}
