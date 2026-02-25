package com.example.finsentinel.config;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PersonaPropertiesTest {
    @Test
    void defaultValues() {
        PersonaProperties props = new PersonaProperties();
        assertThat(props.getPersona()).isEqualTo("default");
        assertThat(props.getPersonasDir()).isEqualTo("classpath:prompts/personas/");
    }

    @Test
    void personaIsConfigurable() {
        PersonaProperties props = new PersonaProperties();
        props.setPersona("conservative");
        assertThat(props.getPersona()).isEqualTo("conservative");
    }
}
