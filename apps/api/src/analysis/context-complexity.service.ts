import { Injectable } from '@nestjs/common';
import type { ComplexityEstimate } from '@finsentinel/shared';

@Injectable()
export class ContextComplexityService {
  private static readonly TOOL_CALL_THRESHOLD = 6;
  private static readonly TOOL_ROUNDS_THRESHOLD = 3;
  private static readonly WALL_CLOCK_THRESHOLD = 20;

  private static readonly INTENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
    { re: /complete analysis/i, label: 'complete analysis' },
    { re: /full analysis/i, label: 'full analysis' },
    { re: /form (a )?decision|decision formation/i, label: 'decision formation' },
    { re: /order draft|generate (an )?order/i, label: 'order draft generation' },
  ];

  estimate(input: { prompt: string }): ComplexityEstimate {
    const prompt = input.prompt.trim();

    for (const { re, label } of ContextComplexityService.INTENT_PATTERNS) {
      if (re.test(prompt)) {
        return {
          predictedToolCalls: 8,
          predictedToolRounds: 4,
          predictedWallClockSec: 25,
          upgradeRecommended: true,
          upgradeReason: `intent:${label}`,
        };
      }
    }

    const tickerMatches = prompt.match(/\b[A-Z]{2,5}(?:-[A-Z]+)?\b/g) ?? [];
    const tickerCount = new Set(tickerMatches).size;
    const comparisonPenalty = /compare|vs|against/i.test(prompt) ? 2 : 0;
    const depthSignals =
      (/fundamental/i.test(prompt) ? 1 : 0) +
      (/technical/i.test(prompt) ? 1 : 0) +
      (/sentiment/i.test(prompt) ? 1 : 0) +
      (/valuation|dcf|multiples?/i.test(prompt) ? 1 : 0);
    const predictedToolCalls = Math.min(1 + tickerCount + comparisonPenalty + depthSignals, 20);
    const predictedToolRounds = Math.max(1, Math.ceil(predictedToolCalls / 3));
    const predictedWallClockSec = 3 + predictedToolCalls * 2.5;

    const upgrade =
      predictedToolCalls >= ContextComplexityService.TOOL_CALL_THRESHOLD ||
      predictedToolRounds >= ContextComplexityService.TOOL_ROUNDS_THRESHOLD ||
      predictedWallClockSec >= ContextComplexityService.WALL_CLOCK_THRESHOLD;

    return {
      predictedToolCalls,
      predictedToolRounds,
      predictedWallClockSec,
      upgradeRecommended: upgrade,
      upgradeReason: upgrade
        ? `heuristic:calls=${predictedToolCalls},rounds=${predictedToolRounds},sec=${predictedWallClockSec.toFixed(1)}`
        : 'below-threshold',
    };
  }
}
