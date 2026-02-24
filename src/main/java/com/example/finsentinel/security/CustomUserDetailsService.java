package com.example.finsentinel.security;

import com.example.finsentinel.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Provides security infrastructure for custom user details service concerns.
 *
 * <p>This class is part of the security layer in FinSentinel.
 */

@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    /**
     * Loads user by username.
     *
     * <p>This method belongs to {@link CustomUserDetailsService} and encapsulates the
     * load user by username workflow.
     * @param username username (String)
     * @return the load user by username result (UserDetails)
     * @throws UsernameNotFoundException if the operation cannot be completed
     */

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        com.example.finsentinel.model.User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new UsernameNotFoundException("User not found: " + username));


        return new UserPrincipal(
                user.getId(),
                user.getUsername(),
                user.getPassword(),
                List.of()
        );
    }
}
