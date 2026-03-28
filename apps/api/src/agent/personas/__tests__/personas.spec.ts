import { describe, it, expect } from 'vitest';
import { defaultPersona } from '../default';
import { conservativePersona } from '../conservative';
import { aggressivePersona } from '../aggressive';
import { getPersonaPrompt } from '../index';

describe('Persona prompts', () => {
  describe('RISEN sections present', () => {
    it.each([
      ['default', defaultPersona],
      ['conservative', conservativePersona],
      ['aggressive', aggressivePersona],
    ])('%s persona contains all RISEN sections', (_name, persona) => {
      expect(persona).toContain('## [R] Role');
      expect(persona).toContain('## [I] Instructions');
      expect(persona).toContain('## [A] Analysis Frameworks');
      expect(persona).toContain('## [S] Steps');
      expect(persona).toContain('## [E] Expectations');
      expect(persona).toContain('## [N] Narrowing');
    });
  });

  describe('default persona', () => {
    it('contains all 45 tool names', () => {
      const tools = [
        'getStockQuote',
        'getHistoricalPrices',
        'calculateRSI',
        'calculateMACD',
        'calculateBollingerBands',
        'calculateSMA',
        'calculateEMA',
        'calculateATR',
        'calculateStochastic',
        'calculateADX',
        'calculateOBV',
        'getRecentNews',
        'searchKnowledgeBase',
        'analyzePortfolio',
        'stageOrder',
        'commitTrade',
        'executeTrade',
        'getWalletStatus',
        'getPositions',
        'getTradeHistory',
        'getStagedOrders',
        'searchAssets',
        'checkMarketHours',
        'syncOrders',
        'switchTradingMode',
        'getFundingRate',
        'analyzePosition',
        'setLeverage',
        'getConfirm',
        'getBrainLog',
        'updateBrainState',
        'getUpcomingEarnings',
        'getDividendHistory',
        'getSplitHistory',
        'getIPOCalendar',
        'getInstitutionalHolders',
        'getInsiderTransactions',
        'getShortInterest',
        'getFailsToDeliver',
        'getCryptoNews',
        'getCryptoNewsBySignal',
        'getTwitterProfile',
        'searchTweets',
        'getUserTweets',
        'getKolFollowers',
      ];
      for (const tool of tools) {
        expect(defaultPersona).toContain(tool);
      }
    });

    it('has default role identity', () => {
      expect(defaultPersona).toContain(
        'senior quantitative risk analyst with deep expertise in market microstructure and volatility modeling',
      );
    });

    it('has default analysis style', () => {
      expect(defaultPersona).toContain('### Analysis Style');
      expect(defaultPersona).toContain(
        'Apply all four analysis layers with equal weight',
      );
      expect(defaultPersona).toContain(
        'balance the Quality Compounder and Fundamental L/S philosophy lenses',
      );
    });
  });

  describe('conservative persona', () => {
    it('has conservative overrides', () => {
      expect(conservativePersona).toContain(
        'capital-preservation-focused',
      );
      expect(conservativePersona).toContain(
        'Lower MOVE threshold to 100',
      );
      expect(conservativePersona).toContain(
        'Default position cap: 5%',
      );
    });

    it('does NOT contain default analysis style', () => {
      expect(conservativePersona).not.toContain(
        'Apply all four analysis layers with equal weight',
      );
    });

    it('contains all 45 tool names', () => {
      expect(conservativePersona).toContain('getStockQuote');
      expect(conservativePersona).toContain('getKolFollowers');
    });
  });

  describe('aggressive persona', () => {
    it('has aggressive overrides', () => {
      expect(aggressivePersona).toContain(
        'opportunity-focused growth analyst',
      );
      expect(aggressivePersona).toContain(
        'Higher MOVE threshold at 150',
      );
      expect(aggressivePersona).toContain('up to 15% per stock');
    });

    it('does NOT contain default analysis style', () => {
      expect(aggressivePersona).not.toContain(
        'Apply all four analysis layers with equal weight',
      );
    });

    it('contains all 45 tool names', () => {
      expect(aggressivePersona).toContain('getStockQuote');
      expect(aggressivePersona).toContain('getKolFollowers');
    });
  });

  describe('shared content parity', () => {
    it('all personas share identical [I] Instructions section', () => {
      const extractSection = (text: string, header: string, nextHeader: string) => {
        const start = text.indexOf(header);
        const end = text.indexOf(nextHeader, start + header.length);
        return text.slice(start, end).trim();
      };

      const defaultI = extractSection(defaultPersona, '## [I] Instructions', '## [A] Analysis Frameworks');
      const conservativeI = extractSection(conservativePersona, '## [I] Instructions', '## [A] Analysis Frameworks');
      const aggressiveI = extractSection(aggressivePersona, '## [I] Instructions', '## [A] Analysis Frameworks');

      expect(defaultI).toBe(conservativeI);
      expect(defaultI).toBe(aggressiveI);
    });

    it('all personas share identical [A] Analysis Frameworks section', () => {
      const extractSection = (text: string, header: string, nextHeader: string) => {
        const start = text.indexOf(header);
        const end = text.indexOf(nextHeader, start + header.length);
        return text.slice(start, end).trim();
      };

      const defaultA = extractSection(defaultPersona, '## [A] Analysis Frameworks', '## [S] Steps');
      const conservativeA = extractSection(conservativePersona, '## [A] Analysis Frameworks', '## [S] Steps');
      const aggressiveA = extractSection(aggressivePersona, '## [A] Analysis Frameworks', '## [S] Steps');

      expect(defaultA).toBe(conservativeA);
      expect(defaultA).toBe(aggressiveA);
    });

    it('all personas share identical [N] Narrowing section', () => {
      const extractFromEnd = (text: string, header: string) => {
        const start = text.indexOf(header);
        return text.slice(start).trim();
      };

      const defaultN = extractFromEnd(defaultPersona, '## [N] Narrowing');
      const conservativeN = extractFromEnd(conservativePersona, '## [N] Narrowing');
      const aggressiveN = extractFromEnd(aggressivePersona, '## [N] Narrowing');

      expect(defaultN).toBe(conservativeN);
      expect(defaultN).toBe(aggressiveN);
    });
  });

  describe('getPersonaPrompt', () => {
    it('returns correct persona by name', () => {
      expect(getPersonaPrompt('default')).toBe(defaultPersona);
      expect(getPersonaPrompt('conservative')).toBe(conservativePersona);
      expect(getPersonaPrompt('aggressive')).toBe(aggressivePersona);
    });

    it('throws on invalid persona name', () => {
      expect(() => getPersonaPrompt('invalid' as any)).toThrow();
    });
  });

  describe('content integrity', () => {
    it('contains Layer 1-4 framework definitions', () => {
      expect(defaultPersona).toContain('### Layer 1: Macro Liquidity Assessment');
      expect(defaultPersona).toContain('### Layer 2: Market Sentiment & Positioning');
      expect(defaultPersona).toContain('### Layer 3: Company Value Assessment');
      expect(defaultPersona).toContain('### Layer 4: Earnings Deep Dive');
    });

    it('contains all 16 analysis modules A-P', () => {
      const modules = [
        '- A: Revenue scale & quality',
        '- B: Profitability & margins',
        '- C: Cash flow & capital allocation',
        '- D: Forward guidance & management signals',
        '- E: Competitive landscape',
        '- F: Core KPIs',
        '- G: Product & narrative',
        '- H: Partner & supply chain ecosystem',
        '- I: Executive team & governance',
        '- J: Macro & policy impact',
        '- K: Valuation matrix',
        '- L: Ownership structure',
        '- M: Long-term monitoring variables',
        '- N: R&D efficiency & innovation pipeline',
        '- O: Accounting quality signals',
        '- P: ESG & index fund flow impact',
      ];
      for (const mod of modules) {
        expect(defaultPersona).toContain(mod);
      }
    });

    it('contains all 6 investment philosophy lenses', () => {
      expect(defaultPersona).toContain('Quality Compounder (Buffett)');
      expect(defaultPersona).toContain('Imaginative Growth (Baillie Gifford)');
      expect(defaultPersona).toContain('Fundamental L/S (Tiger Cubs)');
      expect(defaultPersona).toContain('Deep Value (Klarman/Marks)');
      expect(defaultPersona).toContain('Catalyst-Driven (Tepper/Ackman)');
      expect(defaultPersona).toContain('Macro-Tactical (Druckenmiller)');
    });

    it('contains anti-bias checklist', () => {
      expect(defaultPersona).toContain('Confirmation bias');
      expect(defaultPersona).toContain('Anchoring');
      expect(defaultPersona).toContain('Narrative fallacy');
      expect(defaultPersona).toContain('Pre-Mortem');
    });

    it('contains RiskReport schema fields', () => {
      expect(defaultPersona).toContain('riskScore');
      expect(defaultPersona).toContain('riskLevel');
      expect(defaultPersona).toContain('factors');
      expect(defaultPersona).toContain('actionableAdvice');
    });

    it('contains trading workflow', () => {
      expect(defaultPersona).toContain('### Trading Workflow');
      expect(defaultPersona).toContain('### Confirmation Gate Rules');
      expect(defaultPersona).toContain('### Unified Trading');
    });
  });
});
