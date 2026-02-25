package com.example.finsentinel.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class McpServerPropertiesTest {

    @Test
    void defaults_mcpDisabled() {
        var props = new McpServerProperties();
        assertThat(props.isEnabled()).isFalse();
        assertThat(props.getApiKey()).isEmpty();
        assertThat(props.getUserId()).isEmpty();
    }

    @Test
    void setters_bindCorrectly() {
        var props = new McpServerProperties();
        props.setEnabled(true);
        props.setApiKey("my-secret");
        props.setUserId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

        assertThat(props.isEnabled()).isTrue();
        assertThat(props.getApiKey()).isEqualTo("my-secret");
        assertThat(props.getUserId()).isEqualTo("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    }

    // ── Fail-fast startup validation ─────────────────────────────────

    @Test
    void validate_skipsWhenDisabled() {
        var props = new McpServerProperties();
        props.validate(); // no exception
    }

    @Test
    void validate_failsOnMissingApiKey() {
        var props = new McpServerProperties();
        props.setEnabled(true);
        props.setUserId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

        assertThatThrownBy(props::validate)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("api-key");
    }

    @Test
    void validate_failsOnMissingUserId() {
        var props = new McpServerProperties();
        props.setEnabled(true);
        props.setApiKey("some-key");

        assertThatThrownBy(props::validate)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("user-id");
    }

    @Test
    void validate_failsOnInvalidUuid() {
        var props = new McpServerProperties();
        props.setEnabled(true);
        props.setApiKey("some-key");
        props.setUserId("not-a-uuid");

        assertThatThrownBy(props::validate)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("valid UUID");
    }

    @Test
    void validate_passesWithValidConfig() {
        var props = new McpServerProperties();
        props.setEnabled(true);
        props.setApiKey("my-secret");
        props.setUserId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

        props.validate(); // no exception
    }

    @Test
    void getUserIdAsUUID_returnsCorrectUuid() {
        var props = new McpServerProperties();
        props.setUserId("11111111-2222-3333-4444-555555555555");

        assertThat(props.getUserIdAsUUID().toString())
                .isEqualTo("11111111-2222-3333-4444-555555555555");
    }
}
