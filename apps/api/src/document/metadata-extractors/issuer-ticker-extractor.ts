import { isKnownTicker } from '../../rag/ticker-whitelist';

export interface IssuerTickerInput {
  originalFileName: string | null;
  docTitle: string | null;
  chunkText: string;
}

export interface IssuerTickerResult {
  issuerName?: string;
  tickers: string[];
}

// No trailing \b: the optional \. ends on a non-word char, so \b would
// prevent the dot from ever matching (e.g. "Apple Inc." would capture as "Apple Inc").
const ISSUER_REGEX =
  /\b([A-Z][a-zA-Z&.]+(?:\s+[A-Z][a-zA-Z&.]+)*\s+(?:Inc|Corp|Corporation|Company|Ltd|LLC|Holdings|Group|PLC)\.?)/;
const TOKEN_REGEX = /\b[A-Z]{2,5}\b/g;

export function extractIssuerAndTickers(input: IssuerTickerInput): IssuerTickerResult {
  // Filenames use underscores/hyphens as word separators (e.g. AAPL_10K_2024.pdf).
  // Normalise to spaces so \b[A-Z]{2,5}\b fires correctly on each segment.
  const normalisedFileName = (input.originalFileName ?? '').replace(/[^A-Za-z0-9]/g, ' ');
  const sources = [normalisedFileName, input.docTitle ?? '', input.chunkText];
  const found = new Set<string>();
  for (const src of sources) {
    const matches = src.match(TOKEN_REGEX) ?? [];
    for (const token of matches) {
      if (isKnownTicker(token)) found.add(token);
    }
  }

  let issuerName: string | undefined;
  for (const src of [input.docTitle ?? '', input.chunkText]) {
    const m = src.match(ISSUER_REGEX);
    if (m?.[1]) {
      issuerName = m[1];
      break;
    }
  }

  return {
    tickers: [...found].sort(),
    ...(issuerName ? { issuerName } : {}),
  };
}
