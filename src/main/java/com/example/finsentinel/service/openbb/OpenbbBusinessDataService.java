package com.example.finsentinel.service.openbb;

import com.example.finsentinel.config.OpenbbProperties;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class OpenbbBusinessDataService {

    private final OpenbbPublicDataService openbbPublicDataService;
    private final OpenbbProperties openbbProperties;

    public JsonNode getUsCpi(String startDate, String endDate, Integer limit) {
        OpenbbProperties.Business business = openbbProperties.getBusiness();
        return queryFredLikeSeries(
                business.getCpiPath(),
                business.getMacroProvider(),
                business.getCpiSeriesId(),
                startDate,
                endDate,
                limit
        );
    }

    public JsonNode getUsUnemploymentRate(String startDate, String endDate, Integer limit) {
        OpenbbProperties.Business business = openbbProperties.getBusiness();
        return queryFredLikeSeries(
                business.getUnemploymentPath(),
                business.getMacroProvider(),
                business.getUnemploymentSeriesId(),
                startDate,
                endDate,
                limit
        );
    }

    public JsonNode getUsFedFundsRate(String startDate, String endDate, Integer limit) {
        OpenbbProperties.Business business = openbbProperties.getBusiness();
        return queryFredLikeSeries(
                business.getFedFundsPath(),
                business.getMacroProvider(),
                business.getFedFundsSeriesId(),
                startDate,
                endDate,
                limit
        );
    }

    private JsonNode queryFredLikeSeries(String path,
                                         String provider,
                                         String seriesId,
                                         String startDate,
                                         String endDate,
                                         Integer limit) {
        Map<String, String> params = new LinkedHashMap<>();
        if (StringUtils.hasText(seriesId)) {
            params.put("series_id", seriesId);
        }
        if (StringUtils.hasText(startDate)) {
            params.put("start_date", startDate);
        }
        if (StringUtils.hasText(endDate)) {
            params.put("end_date", endDate);
        }
        if (limit != null && limit > 0) {
            params.put("limit", String.valueOf(limit));
        }
        return openbbPublicDataService.queryPublicData(path, provider, params);
    }
}
