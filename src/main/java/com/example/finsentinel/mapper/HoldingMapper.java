package com.example.finsentinel.mapper;

import com.example.finsentinel.dto.portfolio.HoldingRequest;
import com.example.finsentinel.dto.portfolio.HoldingResponse;
import com.example.finsentinel.model.Holding;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

/**
 * MapStruct mapper between {@link Holding} entity and portfolio DTOs.
 */
@Mapper(componentModel = "spring")
public interface HoldingMapper {


    HoldingResponse toResponse(Holding holding);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "portfolio", ignore = true)
    @Mapping(target = "currentPrice", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    Holding toEntity(HoldingRequest request);
}
