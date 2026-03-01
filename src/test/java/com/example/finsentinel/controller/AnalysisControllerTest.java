package com.example.finsentinel.controller;

import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.ChatService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AnalysisControllerTest {

    @Mock private ChatService chatService;
    @Mock private UserRepository userRepository;
    @InjectMocks private AnalysisController controller;

    @Test
    void streamAnalysis_validTicker_returnsSseEmitter() {
        var user = User.builder().id(UUID.randomUUID()).username("test").build();
        var userDetails = mock(UserDetails.class);
        when(userDetails.getUsername()).thenReturn("test");
        when(userRepository.findByUsername("test")).thenReturn(Optional.of(user));

        SseEmitter emitter = controller.streamAnalysis("AAPL", userDetails);

        assertThat(emitter).isNotNull();
        verify(chatService).streamChat(
                contains("AAPL"), isNull(), isNull(), eq(user.getId()), any(SseEmitter.class));
    }

    @Test
    void streamAnalysis_invalidTicker_throwsException() {
        var userDetails = mock(UserDetails.class);

        assertThatThrownBy(() -> controller.streamAnalysis("'; DROP TABLE", userDetails))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid ticker format");
    }

    @Test
    void streamAnalysis_cryptoTicker_accepted() {
        var user = User.builder().id(UUID.randomUUID()).username("test").build();
        var userDetails = mock(UserDetails.class);
        when(userDetails.getUsername()).thenReturn("test");
        when(userRepository.findByUsername("test")).thenReturn(Optional.of(user));

        SseEmitter emitter = controller.streamAnalysis("BTC-USD", userDetails);

        assertThat(emitter).isNotNull();
        verify(chatService).streamChat(
                contains("BTC-USD"), isNull(), isNull(), eq(user.getId()), any(SseEmitter.class));
    }

    @Test
    void streamAnalysis_emptyTicker_throwsException() {
        var userDetails = mock(UserDetails.class);

        assertThatThrownBy(() -> controller.streamAnalysis("", userDetails))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void streamAnalysis_userNotFound_throws401() {
        var userDetails = mock(UserDetails.class);
        when(userDetails.getUsername()).thenReturn("ghost");
        when(userRepository.findByUsername("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> controller.streamAnalysis("AAPL", userDetails))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("User not found");
    }
}
