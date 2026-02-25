package com.example.finsentinel.service.market;

import com.example.finsentinel.service.openbb.OpenbbPublicDataService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OwnershipDataServiceTest {

    @Mock private OpenbbPublicDataService openbbService;
    @InjectMocks private OwnershipDataService ownershipService;
    private static final ObjectMapper mapper = JsonMapper.builder().build();

    @Test
    void getInstitutionalHolders_returnsFormattedResult() throws Exception {
        JsonNode mockData = mapper.readTree("[{\"investor\":\"Vanguard\",\"shares\":150000000}]");
        when(openbbService.queryPublicData(eq("equity/ownership/institutional"), eq("sec"), anyMap()))
                .thenReturn(mockData);
        String result = ownershipService.getInstitutionalHolders("AAPL");
        assertThat(result).contains("Institutional Holders").contains("Vanguard");
    }

    @Test
    void getInsiderTransactions_returnsFormattedResult() throws Exception {
        JsonNode mockData = mapper.readTree("[{\"name\":\"Tim Cook\",\"transaction\":\"Sale\"}]");
        when(openbbService.queryPublicData(eq("equity/ownership/insider_trading"), eq("sec"), anyMap()))
                .thenReturn(mockData);
        String result = ownershipService.getInsiderTransactions("AAPL");
        assertThat(result).contains("Insider Transactions").contains("Tim Cook");
    }

    @Test
    void getInstitutionalHolders_handlesException() {
        when(openbbService.queryPublicData(anyString(), anyString(), anyMap()))
                .thenThrow(new IllegalArgumentException("OpenBB disabled"));
        String result = ownershipService.getInstitutionalHolders("AAPL");
        assertThat(result).contains("Data unavailable");
    }
}
