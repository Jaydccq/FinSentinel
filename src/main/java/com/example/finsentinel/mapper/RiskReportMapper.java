package com.example.finsentinel.mapper;

import com.example.finsentinel.dto.risk.ComplianceNote;
import com.example.finsentinel.dto.risk.RiskFactor;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.RiskReportEntity;
import com.example.finsentinel.model.enums.RiskLevel;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    @Mapping(target = "disclaimer", source = "complianceNote.disclaimer")
    @Mapping(target = "regulatoryFramework", source = "complianceNote.regulatoryFramework")
    public abstract RiskReportEntity toEntity(RiskReport report);

    /**
     * Maps a {@link RiskReportEntity} back to a {@link RiskReport} DTO.
     */
    @Mapping(target = "riskLevel", source = "riskLevel", qualifiedByName = "riskLevelToString")
    @Mapping(target = "factors", source = "factorsJson", qualifiedByName = "jsonToFactors")
    @Mapping(target = "actionableAdvice", source = "adviceJson", qualifiedByName = "jsonToAdvice")
    @Mapping(target = "summary", source = "summary")
    @Mapping(target = "complianceNote", source = ".", qualifiedByName = "entityToComplianceNote")
    public abstract RiskReport toDto(RiskReportEntity entity);

    /**
     * Executes string to risk level.
     *
     * <p>This method is defined in {@link RiskReportMapper}.
     * @param riskLevel risk level (String)
     * @return the string to risk level result (RiskLevel)
     */

    @Named("stringToRiskLevel")
    protected RiskLevel stringToRiskLevel(String riskLevel) {
        if (riskLevel == null) return RiskLevel.LOW;
        try {

            return RiskLevel.valueOf(riskLevel.toUpperCase());
        } catch (IllegalArgumentException e) {
            return RiskLevel.LOW;
        }
    }

    /**
     * Executes risk level to string.
     *
     * <p>This method is defined in {@link RiskReportMapper}.
     * @param riskLevel risk level (RiskLevel)
     * @return the risk level to string result (String)
     */

    @Named("riskLevelToString")
    protected String riskLevelToString(RiskLevel riskLevel) {
        return riskLevel != null ? riskLevel.name() : RiskLevel.LOW.name();
    }

    /**
     * Executes factors to json.
     *
     * <p>This method is defined in {@link RiskReportMapper}.
     * @param factors factors (List<RiskFactor>)
     * @return the factors to json result (String)
     */

    @Named("factorsToJson")
    protected String factorsToJson(List<RiskFactor> factors) {
        if (factors == null) return "[]";
        try {

            return objectMapper.writeValueAsString(factors);
        } catch (JsonProcessingException e) {
            return "[]";
        }
    }

    /**
     * Executes json to factors.
     *
     * <p>This method is defined in {@link RiskReportMapper}.
     * @param json json (String)
     * @return the json to factors result (List<RiskFactor>)
     */

    @Named("jsonToFactors")
    protected List<RiskFactor> jsonToFactors(String json) {
        if (json == null || json.isBlank()) return Collections.emptyList();
        try {

            return objectMapper.readValue(json, new TypeReference<List<RiskFactor>>() {});
        } catch (JsonProcessingException e) {

            return Collections.emptyList();
        }
    }

    /**
     * Executes advice to json.
     *
     * <p>This method is defined in {@link RiskReportMapper}.
     * @param advice advice (List<String>)
     * @return the advice to json result (String)
     */

    @Named("adviceToJson")
    protected String adviceToJson(List<String> advice) {
        if (advice == null) return "[]";
        try {

            return objectMapper.writeValueAsString(advice);
        } catch (JsonProcessingException e) {
            return "[]";
        }
    }

    /**
     * Executes json to advice.
     *
     * <p>This method is defined in {@link RiskReportMapper}.
     * @param json json (String)
     * @return the json to advice result (List<String>)
     */

    @Named("jsonToAdvice")
    protected List<String> jsonToAdvice(String json) {
        if (json == null || json.isBlank()) return Collections.emptyList();
        try {

            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (JsonProcessingException e) {

            return Collections.emptyList();
        }
    }

    /**
     * Executes entity to compliance note.
     *
     * <p>This method is defined in {@link RiskReportMapper}.
     * @param entity entity (RiskReportEntity)
     * @return the entity to compliance note result (ComplianceNote)
     */

    @Named("entityToComplianceNote")
    protected ComplianceNote entityToComplianceNote(RiskReportEntity entity) {

        return new ComplianceNote(
                entity.getDisclaimer(),
                entity.getRegulatoryFramework(),
                true
        );
    }
}
