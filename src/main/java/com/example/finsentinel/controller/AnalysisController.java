package com.example.finsentinel.controller;

import com.example.finsentinel.model.User;
import com.example.finsentinel.ratelimit.RateLimit;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.ChatService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api/analysis")
@RequiredArgsConstructor
public class AnalysisController {

    private final ChatService chatService;
    private final UserRepository userRepository;

    @RateLimit(limit = 5, windowSecs = 300, key = "analysis:stream")
    @PostMapping(value = "/stream/{ticker}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamAnalysis(
            @PathVariable String ticker,
            @AuthenticationPrincipal UserDetails userDetails) {

        if (!ticker.matches("^[A-Za-z0-9\\-]{1,10}$")) {
            throw new IllegalArgumentException("Invalid ticker format");
        }

        User user = userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        String prompt = loadAnalysisPrompt(ticker);
        SseEmitter emitter = new SseEmitter(180_000L);
        chatService.streamAnalysis(prompt, user.getId(), emitter);
        return emitter;
    }

    private String loadAnalysisPrompt(String ticker) {
        try (InputStream is = getClass().getResourceAsStream("/prompts/stock-analysis.st")) {
            if (is == null) {
                return "Perform a comprehensive investment analysis for " + ticker +
                       " using all available tools. Include price targets and buy/sell zones.";
            }
            String template = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            return template.replace("{ticker}", ticker);
        } catch (IOException e) {
            return "Perform a comprehensive investment analysis for " + ticker +
                   " using all available tools. Include price targets and buy/sell zones.";
        }
    }
}
