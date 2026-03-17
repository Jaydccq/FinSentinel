package com.example.finsentinel.mapper;

import com.example.finsentinel.dto.risk.RiskFactor;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.RiskReportEntity;
import com.example.finsentinel.model.enums.RiskLevel;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.Named;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Collections;
import java.util.List;

/**
 * MapStruct mapper between the {@link RiskReport} DTO record and the
 * {@link RiskReportEntity} JPA entity.
 * <p>
 * Because {@link RiskReportEntity} stores {@code factors} and {@code advice}

 * as JSON strings (JSONB column), the mapper uses Jackson for serialisation
 * and deserialisation via {@code @Named} converter methods.
 * <p>
 * {@code componentModel = "spring"} with {@code uses = {}} and
 * {@code injectionStrategy = CONSTRUCTOR} — MapStruct generates an
 * abstract class so we can {@code @Autowired} Jackson's {@link ObjectMapper}.
 */
@Mapper(componentModel = "spring")
public abstract class RiskReportMapper {

    @Autowired
    protected ObjectMapper objectMapper;

    /**
     * Maps a {@link RiskReport} DTO to a {@link RiskReportEntity}.
     * The {@code portfolio} and {@code id} fields must be set by the caller
     * after mapping.
     */
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "portfolio", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "riskLevel", source = "riskLevel", qualifiedByName = "stringToRiskLevel")
    @Mapping(target = "factorsJson", source = "factors", qualifiedByName = "factorsToJson")
    @Mapping(target = "adviceJson", source = "actionableAdvice", qualifiedByName = "adviceToJson")
    public abstract RiskReportEntity toEntity(RiskReport report);

    /**
     * Maps a {@link RiskReportEntity} back to a {@link RiskReport} DTO.
     */
    @Mapping(target = "riskLevel", source = "riskLevel", qualifiedByName = "riskLevelToString")
    @Mapping(target = "factors", source = "factorsJson", qualifiedByName = "jsonToFactors")
    @Mapping(target = "actionableAdvice", source = "adviceJson", qualifiedByName = "jsonToAdvice")
    public abstract RiskReport toDto(RiskReportEntity entity);

    @Named("stringToRiskLevel")
    protected RiskLevel stringToRiskLevel(String riskLevel) {
        if (riskLevel == null) return RiskLevel.LOW;
        try {

            return RiskLevel.valueOf(riskLevel.toUpperCase());
        } catch (IllegalArgumentException e) {
            return RiskLevel.LOW;
        }
    }

    @Named("riskLevelToString")
    protected String riskLevelToString(RiskLevel riskLevel) {
        return riskLevel != null ? riskLevel.name() : RiskLevel.LOW.name();
    }

    @Named("factorsToJson")
    protected String factorsToJson(List<RiskFactor> factors) {
        if (factors == null) return "[]";
        try {

            return objectMapper.writeValueAsString(factors);
        } catch (JacksonException e) {
            return "[]";
        }
    }

    @Named("jsonToFactors")
    protected List<RiskFactor> jsonToFactors(String json) {
        if (json == null || json.isBlank()) return Collections.emptyList();
        try {

            return objectMapper.readValue(json, new TypeReference<List<RiskFactor>>() {});
        } catch (JacksonException e) {

            return Collections.emptyList();
        }
    }

    @Named("adviceToJson")
    protected String adviceToJson(List<String> advice) {
        if (advice == null) return "[]";
        try {

            return objectMapper.writeValueAsString(advice);
        } catch (JacksonException e) {
            return "[]";
        }
    }

    @Named("jsonToAdvice")
    protected List<String> jsonToAdvice(String json) {
        if (json == null || json.isBlank()) return Collections.emptyList();
        try {

            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (JacksonException e) {

            return Collections.emptyList();
        }
    }
}
