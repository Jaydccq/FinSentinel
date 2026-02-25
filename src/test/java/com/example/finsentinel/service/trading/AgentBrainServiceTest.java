package com.example.finsentinel.service.trading;

import com.example.finsentinel.model.AgentBrain;
import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.AgentBrainRepository;
import com.example.finsentinel.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AgentBrainServiceTest {

    @Mock private AgentBrainRepository brainRepository;
    @Mock private UserRepository userRepository;

    private AgentBrainService service;
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new AgentBrainService(brainRepository, userRepository);
    }

    @Test
    void getBrainLog_emptyHistory_returnsMessage() {
        AgentBrain brain = AgentBrain.builder()
                .user(createUser())
                .build();
        when(brainRepository.findByUserId(userId)).thenReturn(Optional.of(brain));

        String result = service.getBrainLog(userId, 10);
        assertThat(result).contains("No brain commits yet");
    }

    @Test
    void getBrainLog_withHistory_showsNewestFirst() {
        List<Map<String, Object>> history = new ArrayList<>();

        Map<String, Object> commit1 = new LinkedHashMap<>();
        commit1.put("hash", "aaa11111");
        commit1.put("type", "strategy");
        commit1.put("message", "First strategy update");
        commit1.put("timestamp", "2026-02-24T10:00:00");
        history.add(commit1);

        Map<String, Object> commit2 = new LinkedHashMap<>();
        commit2.put("hash", "bbb22222");
        commit2.put("type", "emotion");
        commit2.put("message", "Emotion: neutral -> confident. Reason: Bull market");
        commit2.put("timestamp", "2026-02-24T11:00:00");
        history.add(commit2);

        AgentBrain brain = AgentBrain.builder()
                .user(createUser())
                .commitHistory(history)
                .build();
        when(brainRepository.findByUserId(userId)).thenReturn(Optional.of(brain));

        String result = service.getBrainLog(userId, 10);
        assertThat(result).contains("Brain Commit Log");
        assertThat(result).contains("bbb22222");
        assertThat(result).contains("aaa11111");
        // Newest should appear before oldest
        assertThat(result.indexOf("bbb22222")).isLessThan(result.indexOf("aaa11111"));
        assertThat(result).contains("Showing 2 of 2 total commits");
    }

    @Test
    void getBrainLog_respectsLimit() {
        List<Map<String, Object>> history = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            Map<String, Object> commit = new LinkedHashMap<>();
            commit.put("hash", "hash" + i);
            commit.put("type", "strategy");
            commit.put("message", "Update " + i);
            commit.put("timestamp", "2026-02-24T1" + i + ":00:00");
            history.add(commit);
        }

        AgentBrain brain = AgentBrain.builder()
                .user(createUser())
                .commitHistory(history)
                .build();
        when(brainRepository.findByUserId(userId)).thenReturn(Optional.of(brain));

        String result = service.getBrainLog(userId, 2);
        assertThat(result).contains("Showing 2 of 5 total commits");
        assertThat(result).contains("hash4");
        assertThat(result).contains("hash3");
        assertThat(result).doesNotContain("hash0");
    }

    @Test
    void updateFrontalLobe_recordsCommit() {
        AgentBrain brain = AgentBrain.builder()
                .user(createUser())
                .build();
        when(brainRepository.findByUserId(userId)).thenReturn(Optional.of(brain));
        when(brainRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        String result = service.updateFrontalLobe(userId, "Buy tech stocks on dips");
        assertThat(result).contains("Strategy updated successfully");
        assertThat(brain.getCommitHistory()).hasSize(1);
        assertThat(brain.getCommitHistory().get(0).get("type")).isEqualTo("strategy");
    }

    @Test
    void updateEmotion_recordsCommit() {
        AgentBrain brain = AgentBrain.builder()
                .user(createUser())
                .build();
        when(brainRepository.findByUserId(userId)).thenReturn(Optional.of(brain));
        when(brainRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        String result = service.updateEmotion(userId, "confident", "Bull market signals");
        assertThat(result).contains("neutral").contains("confident");
        assertThat(brain.getCommitHistory()).hasSize(1);
        assertThat(brain.getCommitHistory().get(0).get("type")).isEqualTo("emotion");
    }

    private User createUser() {
        User user = new User();
        user.setId(userId);
        return user;
    }
}
