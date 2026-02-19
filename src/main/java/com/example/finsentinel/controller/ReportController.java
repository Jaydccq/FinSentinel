package com.example.finsentinel.controller;

import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.ReportService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Exposes REST endpoints for report controller operations.
 *
 * <p>This class belongs to the controller layer in FinSentinel.
 */

@RestController
@RequestMapping("/api/reports")
@RequiredArgsConstructor
public class ReportController {

    private final ReportService reportService;
    private final UserRepository userRepository;

    /**
     * Downloads pdf.
     *
     * <p>This method belongs to {@link ReportController} and encapsulates the
     * download pdf workflow.
     * @param id id (UUID)
     * @return the download pdf result (ResponseEntity<byte[]>)
     */

    @GetMapping(value = "/{id}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> downloadPdf(@PathVariable UUID id,
                                              @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        byte[] pdf = reportService.generatePdf(id, user.getId());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename("risk-report-" + id + ".pdf")
                .build());


        return ResponseEntity.ok()
                .headers(headers)
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdf);
    }

    private User resolveUser(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"));
    }
}
