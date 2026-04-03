import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { portfolios, holdings, riskReports, eq, and, inArray, desc } from '@finsentinel/db';
import type {
  PortfolioRequest,
  PortfolioResponse,
  HoldingRequest,
  HoldingResponse,
  PortfolioAnalyticsResponse,
  HoldingWeight,
} from '@finsentinel/shared';

@Injectable()
export class PortfolioService {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
  ) {}

  // ── Portfolio CRUD ─────────────────────────────────────────────────────

  async createPortfolio(
    userId: string,
    request: PortfolioRequest,
  ): Promise<PortfolioResponse> {
    const [created] = await this.db
      .insert(portfolios)
      .values({
        name: request.name,
        description: request.description ?? null,
        userId,
        totalValue: '0',
      })
      .returning();

    return this.toPortfolioResponse(created, []);
  }

  async getPortfolios(userId: string): Promise<PortfolioResponse[]> {
    const rows = await this.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.userId, userId));

    if (rows.length === 0) return [];

    // Fetch all holdings in a single query to avoid N+1
    const portfolioIds = rows.map((r: Record<string, unknown>) => r.id as string);
    const allHoldings = await this.db
      .select()
      .from(holdings)
      .where(inArray(holdings.portfolioId, portfolioIds));

    // Group holdings by portfolioId in memory
    const holdingsByPortfolio = new Map<string, Record<string, unknown>[]>();
    for (const h of allHoldings) {
      const pid = h.portfolioId as string;
      if (!holdingsByPortfolio.has(pid)) {
        holdingsByPortfolio.set(pid, []);
      }
      holdingsByPortfolio.get(pid)!.push(h as Record<string, unknown>);
    }

    return rows.map((row: Record<string, unknown>) =>
      this.toPortfolioResponse(row, holdingsByPortfolio.get(row.id as string) ?? []),
    );
  }

  async getPortfolio(
    userId: string,
    portfolioId: string,
  ): Promise<PortfolioResponse> {
    const [row] = await this.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.id, portfolioId))
      .limit(1);

    if (!row) {
      throw new NotFoundException(`Portfolio ${portfolioId} not found`);
    }

    if (row.userId !== userId) {
      throw new ForbiddenException('Not authorized to access this portfolio');
    }

    const holdingRows = await this.db
      .select()
      .from(holdings)
      .where(eq(holdings.portfolioId, portfolioId));

    return this.toPortfolioResponse(row, holdingRows);
  }

  async updatePortfolio(
    userId: string,
    portfolioId: string,
    request: PortfolioRequest,
  ): Promise<PortfolioResponse> {
    // Verify ownership
    await this.getPortfolio(userId, portfolioId);

    const [updated] = await this.db
      .update(portfolios)
      .set({
        name: request.name,
        description: request.description ?? null,
        updatedAt: new Date(),
      })
      .where(eq(portfolios.id, portfolioId))
      .returning();

    const holdingRows = await this.db
      .select()
      .from(holdings)
      .where(eq(holdings.portfolioId, portfolioId));

    return this.toPortfolioResponse(updated, holdingRows);
  }

  async deletePortfolio(userId: string, portfolioId: string): Promise<void> {
    // Verify ownership
    await this.getPortfolio(userId, portfolioId);

    // Delete cascade: holdings, risk reports, then portfolio
    await this.db
      .delete(holdings)
      .where(eq(holdings.portfolioId, portfolioId));

    await this.db
      .delete(riskReports)
      .where(eq(riskReports.portfolioId, portfolioId));

    await this.db
      .delete(portfolios)
      .where(eq(portfolios.id, portfolioId));
  }

  // ── Holding CRUD ───────────────────────────────────────────────────────

  async addHolding(
    userId: string,
    portfolioId: string,
    request: HoldingRequest,
  ): Promise<HoldingResponse> {
    // Verify ownership
    await this.getPortfolio(userId, portfolioId);

    const [created] = await this.db
      .insert(holdings)
      .values({
        portfolioId,
        symbol: request.symbol,
        companyName: request.companyName ?? null,
        quantity: request.quantity,
        averageCost: request.averageCost,
        currentPrice: request.averageCost, // default to cost basis
        sector: request.sector ?? null,
      })
      .returning();

    return this.toHoldingResponse(created);
  }

  async getHoldings(
    userId: string,
    portfolioId: string,
  ): Promise<HoldingResponse[]> {
    // Verify ownership
    await this.getPortfolio(userId, portfolioId);

    const rows = await this.db
      .select()
      .from(holdings)
      .where(eq(holdings.portfolioId, portfolioId));

    return rows.map((row: Record<string, unknown>) => this.toHoldingResponse(row));
  }

  async updateHolding(
    userId: string,
    portfolioId: string,
    holdingId: string,
    request: HoldingRequest,
  ): Promise<HoldingResponse> {
    // Verify portfolio ownership
    await this.getPortfolio(userId, portfolioId);

    // Verify holding exists and belongs to portfolio
    const [existing] = await this.db
      .select()
      .from(holdings)
      .where(
        and(eq(holdings.id, holdingId), eq(holdings.portfolioId, portfolioId)),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Holding ${holdingId} not found`);
    }

    const [updated] = await this.db
      .update(holdings)
      .set({
        symbol: request.symbol,
        companyName: request.companyName ?? null,
        quantity: request.quantity,
        averageCost: request.averageCost,
        sector: request.sector ?? null,
        updatedAt: new Date(),
      })
      .where(eq(holdings.id, holdingId))
      .returning();

    return this.toHoldingResponse(updated);
  }

  async deleteHolding(
    userId: string,
    portfolioId: string,
    holdingId: string,
  ): Promise<void> {
    // Verify portfolio ownership
    await this.getPortfolio(userId, portfolioId);

    // Verify holding exists
    const [existing] = await this.db
      .select()
      .from(holdings)
      .where(
        and(eq(holdings.id, holdingId), eq(holdings.portfolioId, portfolioId)),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Holding ${holdingId} not found`);
    }

    await this.db.delete(holdings).where(eq(holdings.id, holdingId));
  }

  // ── Analytics ──────────────────────────────────────────────────────────

  async getPortfolioAnalytics(
    userId: string,
    portfolioId: string,
  ): Promise<PortfolioAnalyticsResponse> {
    // Verify ownership and reuse holdings already fetched by getPortfolio
    const portfolio = await this.getPortfolio(userId, portfolioId);

    // Map PortfolioResponse holdings back to row-like objects for analytics
    const holdingRows = portfolio.holdings.map((h) => ({
      symbol: h.symbol,
      companyName: h.companyName,
      quantity: h.quantity,
      averageCost: h.averageCost,
      currentPrice: h.currentPrice,
      sector: h.sector,
    }));

    // Calculate market values and total
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const holdingCalcs = holdingRows.map((h: any) => {
        const qty = parseFloat(h.quantity ?? '0');
        const price = parseFloat(h.currentPrice ?? h.averageCost ?? '0');
        const cost = parseFloat(h.averageCost ?? '0');
        const marketValue = qty * price;
        const costBasis = qty * cost;
        const unrealizedPnl = marketValue - costBasis;
        const pnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

        return {
          ...h,
          marketValue,
          costBasis,
          unrealizedPnl,
          pnlPercent,
        };
      },
    );

    const totalMarketValue = holdingCalcs.reduce(
      (sum: number, h: { marketValue: number }) => sum + h.marketValue,
      0,
    );

    // Calculate weights and HHI
    const holdingWeights: HoldingWeight[] = holdingCalcs.map(
      (h: {
        symbol: string;
        companyName: string;
        sector: string;
        marketValue: number;
        unrealizedPnl: number;
        pnlPercent: number;
      }) => {
        const weightPercent =
          totalMarketValue > 0 ? (h.marketValue / totalMarketValue) * 100 : 0;
        return {
          symbol: h.symbol,
          companyName: h.companyName ?? '',
          sector: h.sector ?? 'Unknown',
          marketValue: h.marketValue.toFixed(2),
          weightPercent: weightPercent.toFixed(2),
          unrealizedPnl: h.unrealizedPnl.toFixed(2),
          pnlPercent: h.pnlPercent.toFixed(2),
        };
      },
    );

    // HHI = sum of squared weight percentages
    const hhiIndex = holdingWeights.reduce((sum, w) => {
      const pct = parseFloat(w.weightPercent);
      return sum + pct * pct;
    }, 0);

    // Round to nearest integer
    const hhiRounded = Math.round(hhiIndex);

    // HHI classification
    let hhiClassification: string;
    if (hhiRounded < 1500) {
      hhiClassification = 'Well Diversified';
    } else if (hhiRounded < 2500) {
      hhiClassification = 'Moderately Concentrated';
    } else {
      hhiClassification = 'Highly Concentrated';
    }

    // Sector allocation: group by sector, sum market values
    const sectorAllocation: Record<string, string> = {};
    for (const h of holdingCalcs) {
      const sector = h.sector ?? 'Unknown';
      const existing = parseFloat(sectorAllocation[sector] ?? '0');
      sectorAllocation[sector] = (existing + h.marketValue).toFixed(2);
    }

    // Concentration warnings
    const concentrationWarnings: string[] = [];
    for (const w of holdingWeights) {
      const pct = parseFloat(w.weightPercent);
      if (pct > 25) {
        concentrationWarnings.push(
          `${w.symbol} represents ${w.weightPercent}% of portfolio (>25% threshold)`,
        );
      }
    }
    if (hhiRounded >= 2500) {
      concentrationWarnings.push(
        `Portfolio is highly concentrated (HHI: ${hhiRounded})`,
      );
    }

    return {
      totalMarketValue: totalMarketValue.toFixed(2),
      sectorAllocation,
      hhiIndex: hhiRounded,
      hhiClassification,
      holdingWeights,
      concentrationWarnings,
    };
  }

  async analyzePortfolio(
    userId: string,
    portfolioId: string,
  ): Promise<string> {
    const analytics = await this.getPortfolioAnalytics(userId, portfolioId);
    return JSON.stringify(analytics, null, 2);
  }

  // ── Reports ───────────────────────────────────────────────────────────

  async getReports(userId: string, portfolioId: string) {
    // Verify ownership first
    await this.getPortfolio(userId, portfolioId);

    const rows = await this.db
      .select()
      .from(riskReports)
      .where(eq(riskReports.portfolioId, portfolioId))
      .orderBy(desc(riskReports.createdAt));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: any) => ({
      id: r.id,
      riskScore: Number(r.riskScore),
      riskLevel: r.riskLevel,
      summary: r.summary,
      factors: r.factors ?? [],
      actionableAdvice: r.actionableAdvice ?? [],
      createdAt: r.createdAt?.toISOString(),
    }));
  }

  // ── Mappers ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPortfolioResponse(row: any, holdingRows: any[]): PortfolioResponse {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      totalValue: row.totalValue ?? '0',
      holdings: holdingRows.map((h: Record<string, unknown>) => this.toHoldingResponse(h)),
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toHoldingResponse(row: any): HoldingResponse {
    return {
      id: row.id,
      symbol: row.symbol,
      companyName: row.companyName ?? '',
      quantity: row.quantity ?? '0',
      averageCost: row.averageCost ?? '0',
      currentPrice: row.currentPrice ?? '0',
      sector: row.sector ?? '',
    };
  }
}
