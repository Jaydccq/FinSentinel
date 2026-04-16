import { Injectable } from '@nestjs/common';
import type { ComplexityEstimate } from '@finsentinel/shared';
import { ContextComplexityService } from './context-complexity.service';

@Injectable()
export class PreflightPlannerService {
  constructor(private readonly complexity: ContextComplexityService) {}

  async decide(input: { prompt: string }): Promise<ComplexityEstimate> {
    return this.complexity.estimate(input);
  }
}
