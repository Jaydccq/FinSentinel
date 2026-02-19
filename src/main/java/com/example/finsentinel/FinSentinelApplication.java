package com.example.finsentinel;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Defines the fin sentinel application application entry component.
 *
 * <p>This class belongs to the root layer in FinSentinel.
 */

@SpringBootApplication
@EnableScheduling
public class FinSentinelApplication {

    /**
     * Executes main.
     *
     * <p>This method belongs to {@link FinSentinelApplication} and encapsulates the
     * main workflow.
     * @param args args (String[])
     */

    public static void main(String[] args) {
        SpringApplication.run(FinSentinelApplication.class, args);
    }

}
