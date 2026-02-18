package com.example.finsentinel.mapper;

import com.example.finsentinel.dto.portfolio.PortfolioRequest;
import com.example.finsentinel.dto.portfolio.PortfolioResponse;
import com.example.finsentinel.model.Portfolio;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

/**
 * MapStruct mapper between {@link Portfolio} entity and portfolio DTOs.
 */
@Mapper(componentModel = "spring", uses = HoldingMapper.class)
public interface PortfolioMapper {

    /**
     * Maps a {@link Portfolio} entity to {@link PortfolioResponse}.
     * The nested {@code holdings} list is mapped via {@link HoldingMapper}.
     */
    PortfolioResponse toResponse(Portfolio portfolio);

    /**
     * Maps a {@link PortfolioRequest} to a new {@link Portfolio} entity.
     * Relational fields (id, user, holdings, riskReports, timestamps)
     * are ignored — the service layer sets them explicitly.
     */
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "user", ignore = true)
    @Mapping(target = "holdings", ignore = true)
    @Mapping(target = "riskReports", ignore = true)
    @Mapping(target = "totalValue", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    Portfolio toEntity(PortfolioRequest request);
}
