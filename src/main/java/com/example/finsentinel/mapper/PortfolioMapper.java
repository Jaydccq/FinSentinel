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

    PortfolioResponse toResponse(Portfolio portfolio);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "user", ignore = true)
    @Mapping(target = "holdings", ignore = true)
    @Mapping(target = "riskReports", ignore = true)
    @Mapping(target = "totalValue", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    Portfolio toEntity(PortfolioRequest request);
}
