/**
 * Regex-based heuristics that infer a document's `regionId` from the
 * uploaded filename. Returns `null` when no rule fires — the caller then
 * falls back to the explicit `'UNKNOWN'` sentinel.
 *
 * Rules are deliberately conservative: a bad guess routes documents to
 * the wrong region and degrades retrieval quality, while `'UNKNOWN'`
 * just means "no region filter" at retrieval time. F-13 follow-ups:
 *   - PDF metadata parsing (Author / Producer) for a stronger signal.
 *   - Per-scraper regionId injection at the source side.
 *   - Agent event emission (needs V23 migration for new event type).
 */

interface RegionRule {
  region: string;
  pattern: RegExp;
  /** Stamped into structured logs so we can measure which rules actually fire. */
  label: string;
}

// Ordered: the first matching rule wins. Strongest signals first.
//
// Boundary note: JS regex `\b` counts `_` as a word char, so `\b10-K\b`
// fails to match "10-K_AAPL". We use explicit non-alphanumeric boundaries
// instead — this also handles filename separators cleanly.
const NON_ALNUM = '(?:^|[^A-Za-z0-9])';
const NON_ALNUM_END = '(?:[^A-Za-z0-9]|$)';

const RULES: RegionRule[] = [
  // SEC filing codes — unambiguous US markers.
  {
    region: 'US',
    label: 'sec-filing-code',
    pattern: new RegExp(
      `${NON_ALNUM}(10[-_]?K|10[-_]?Q|8[-_]?K|S[-_]?1|DEF[- _]?14A)${NON_ALNUM_END}`,
      'i',
    ),
  },
  // HKEX disclosure portal filenames + common CJK transliteration.
  { region: 'HK', label: 'hkex-marker', pattern: /(hkex|港股|港交所)/i },
  // Chinese A-share markers (CSRC filings, commonly numeric + 年报/季报/公告).
  { region: 'CN', label: 'cn-report-zh', pattern: /(年报|季报|年度报告|半年报|招股说明书|公司公告)/ },
  // EU markets: MiFID/ESMA tagging often appears in filenames.
  {
    region: 'EU',
    label: 'eu-mifid-esma',
    pattern: new RegExp(`${NON_ALNUM}(MiFID|ESMA|AIFMD|UCITS)${NON_ALNUM_END}`, 'i'),
  },
  // Japan: EDINET reserved words + 有価証券報告書 (securities registration).
  {
    region: 'JP',
    label: 'edinet-marker',
    pattern: /(EDINET|有価証券報告書)/i,
  },
];

export interface RegionInferenceOutcome {
  regionId: string;
  /** `null` when the caller's explicit regionId was honored. */
  inferredFrom: string | null;
}

/**
 * Infer `regionId` when the caller hasn't supplied one. `explicit` taking
 * priority means scrapers that already know the region (SEC, etc.) keep
 * their accuracy — this inference is a best-effort fallback.
 */
export function resolveRegion(
  originalFileName: string,
  explicit: string | undefined,
): RegionInferenceOutcome {
  if (explicit) return { regionId: explicit, inferredFrom: null };

  for (const rule of RULES) {
    if (rule.pattern.test(originalFileName)) {
      return { regionId: rule.region, inferredFrom: rule.label };
    }
  }

  return { regionId: 'UNKNOWN', inferredFrom: null };
}
