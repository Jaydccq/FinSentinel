#!/usr/bin/env node
/**
 * Offline shadow eval — query-classifier comparison vs golden v2.2.
 *
 * Scope: phase 1 of `docs/exec-plans/2026-04-26-query-classifier-shadow-phase1.md`.
 *   - Reads `services/evaluation-runner/datasets/golden.json`.
 *   - Runs the rule classifier (inlined below — see "rules implementation")
 *     against every entry's `query` and compares to `query_class`.
 *   - Optionally (`--llm`) runs an LLM classifier via OpenRouter using the
 *     same prompt as the Nest service (`apps/api/src/rag/query-classifier-llm.ts`).
 *   - Emits a per-class precision / recall / confusion / vocabulary-gap
 *     report to `services/evaluation-runner/reports/classifier-shadow-<ISO>.json`.
 *
 * Decision: rule logic is duplicated inline rather than imported via tsx.
 * Reasons: (a) keep the script runnable on stock Node with zero workspace
 * setup, (b) avoid coupling eval-runner to API tsconfig, (c) the rule
 * vocabulary is small enough that drift risk is manageable. The pure module
 * (`apps/api/src/rag/query-classifier-rules.ts`) and this inline mirror MUST
 * stay byte-for-byte aligned on regex constants — see test
 * `apps/api/src/rag/__tests__/query-classifier-rules.spec.ts` for the
 * canonical behavioural check.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// ── CLI args ────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const datasetPath = args.get('--dataset') ?? 'services/evaluation-runner/datasets/golden.json';
const metaPath = args.get('--meta') ?? 'services/evaluation-runner/datasets/golden.meta.json';
const useLlm = args.has('--llm');
const llmModel = args.get('--llm-model') ?? 'openai/gpt-4o-mini';
const limit = args.get('--limit') ? Number(args.get('--limit')) : undefined;
const yes = args.has('--yes');
const isoDay = new Date().toISOString().slice(0, 10);
const outPath =
  args.get('--out') ?? `services/evaluation-runner/reports/classifier-shadow-${isoDay}.json`;

const repoRoot = resolve(import.meta.dirname, '../..');

// ── Load dataset ────────────────────────────────────────────────────────────

const dataset = readJson(resolve(repoRoot, datasetPath));
const meta = readJson(resolve(repoRoot, metaPath), true);

if (!Array.isArray(dataset?.entries)) {
  fatal(`dataset.entries missing or not an array in ${datasetPath}`);
}

const allEntries = dataset.entries;
const entries = limit ? allEntries.slice(0, limit) : allEntries;

// ── Rule classifier (inlined mirror of query-classifier-rules.ts) ──────────
// Phase 1.5 (2026-04-26): vocabulary closed against golden v2.2.

const RELATION_CUES =
  /\b(competitor|supplier|partner|acquired|subsidiary|related|connected|supply chain|board member|invested in|CEO of)\b/i;
const GRAPH_QUERY_PATTERNS =
  /\b(who|which companies|what companies|competitors of|suppliers of|partners of|how .* connected|how .* related)\b/i;
const ANALYTICAL_KEYWORDS =
  /\b(compare|analyze|analyse|explain|summarize|summarise|impact|risk|driver|outlook)\b/i;
const ANALYTICAL_LENGTH_THRESHOLD = 120;
const TICKER_CANDIDATE = /\b[A-Z]{2,5}\b/g;
const TIME_ANCHOR = /\b(?:Q[1-4]|FY\d{2,4}|20\d{2})\b/;
const SECTION_IDENTIFIER = /\b(?:Item\s+\d+[A-Z]?|Section\s+\d+(?:\.\d+)*|Note\s+\d+|Part\s+[IVX]+)\b/i;
const NUMERIC_IDENTIFIER = /\bISIN\s+[A-Z0-9]{12}\b|\bCUSIP\s+[A-Z0-9]{9}\b|\bEPS\b|\bP\/E\b/;
const QUOTED_PHRASE = /"[^"]{3,}"/;
// DOC_TYPE_KEYWORDS retained for diagnostic use; no longer fires the
// triple-gate fallback after phase 1.5 tightening.
const DOC_TYPE_KEYWORDS = /\b(revenue|earnings|10-?K|10-?Q|8-?K|filing|report|guidance)\b/i;
const NUMERIC_QUERY =
  /\b(EPS|earnings per share|P\/?E ratio|diluted EPS|revenue per share|growth rate|operating margin|gross margin|net margin|price target|market cap)\b/i;
const SUMMARY_INTENT =
  /\b(summary of|give me a (quick )?rundown|tldr|tl;dr|brief overview|short summary|what does .{1,80} do\??|tell me about|explain in (one|short))\b/i;
const COLLOQUIAL_OPENERS =
  /^\s*(hi|hello|hey|yo|sup|thanks?|thank\s+you|ty|tysm|bye|goodbye|ok(ay)?|cool|lol|nice|got\s+it|sounds\s+good|help(?:\s+me)?)[\s!?.,]*$/i;

// Curated whitelist mirror (subset; keep in sync with apps/api/src/rag/ticker-whitelist.ts).
// We load the full whitelist at runtime from the source file to avoid drift.
const tickerWhitelist = loadTickerWhitelist();

function loadTickerWhitelist() {
  const src = resolve(repoRoot, 'apps/api/src/rag/ticker-whitelist.ts');
  try {
    const text = readFileSync(src, 'utf8');
    // Extract a single ALLCAPS-string array literal occurrence; fail-soft.
    const arrayMatch = text.match(/\[[\s\S]*?\]/);
    if (!arrayMatch) return new Set();
    const tickers = Array.from(arrayMatch[0].matchAll(/'([A-Z]{1,6})'|"([A-Z]{1,6})"/g)).map(
      (m) => m[1] ?? m[2],
    );
    return new Set(tickers);
  } catch {
    return new Set();
  }
}

function isKnownTicker(t) {
  return tickerWhitelist.has(t);
}

function classifyByRules(query) {
  if (isExactLookup(query)) return { class: 'exact_lookup', confidence: 1, rule: 'exact_lookup' };
  if (isMultiPart(query)) return { class: 'multi_part', confidence: 1, rule: 'multi_part' };
  if (NUMERIC_QUERY.test(query)) return { class: 'numeric', confidence: 1, rule: 'numeric' };
  if (SUMMARY_INTENT.test(query)) return { class: 'summary', confidence: 1, rule: 'summary' };
  if (RELATION_CUES.test(query) || GRAPH_QUERY_PATTERNS.test(query))
    return { class: 'relational', confidence: 1, rule: 'relational' };
  if (ANALYTICAL_KEYWORDS.test(query))
    return { class: 'analytical', confidence: 1, rule: 'analytical_keyword' };
  if (query.length > ANALYTICAL_LENGTH_THRESHOLD)
    return { class: 'analytical', confidence: 0.5, rule: 'analytical_length' };
  if (COLLOQUIAL_OPENERS.test(query)) return { class: 'colloquial', confidence: 1, rule: 'colloquial' };
  return { class: 'factoid', confidence: 0.4, rule: 'fallback' };
}

function isExactLookup(query) {
  if (SECTION_IDENTIFIER.test(query)) return true;
  if (NUMERIC_IDENTIFIER.test(query)) return true;
  if (QUOTED_PHRASE.test(query)) return true;
  if (!TIME_ANCHOR.test(query)) return false;
  const candidates = Array.from(query.matchAll(TICKER_CANDIDATE), (m) => m[0]);
  if (candidates.length === 0) return false;
  if (candidates.some(isKnownTicker)) return true;
  // Phase 1.5: tightened — doc-type keyword alone is no longer enough.
  return false;
}

function isMultiPart(query) {
  const qm = (query.match(/\?/g) ?? []).length;
  if (qm >= 2) return true;
  if (/\?\s*and\b|\band\b[^?]*\?/i.test(query)) return true;
  return false;
}

// ── LLM classifier (mirrors apps/api/src/rag/query-classifier-llm.ts) ──────

const LLM_SYSTEM_PROMPT = `Classify each financial-research query into exactly one of:
- exact_lookup: literal section / ticker+time / quoted phrase / numeric id (ISIN, CUSIP, EPS, P/E)
- factoid: short factual question with a single answer
- relational: about relationships between companies / entities (competitors, suppliers, partners, board members, CEO of)
- analytical: requires analysis, compare, explain, impact, risk, driver, outlook
- multi_part: contains multiple distinct sub-questions joined with "and" / "?"
- numeric: question about a specific numeric metric (EPS, P/E, operating margin, gross margin, growth rate, price target, market cap)
- summary: request for a company / topic overview without deep analysis (summary of, tldr, tell me about, give me a rundown)
- colloquial: chitchat / non-research (hi, thanks, bye, ok, etc.)

Respond with ONLY a single-line JSON object: {"class":"<class>","confidence":<0..1>,"reasoning":"<one short sentence>"}`;

const LLM_FEW_SHOT = [
  { q: 'AAPL Q4 2025 EPS', class: 'exact_lookup' },
  { q: 'What is the current Apple revenue?', class: 'factoid' },
  { q: 'who are competitors of Tesla?', class: 'relational' },
  { q: 'compare Apple and Microsoft margin trends', class: 'analytical' },
  { q: 'What is Tesla revenue and what is the operating margin?', class: 'multi_part' },
  { q: 'What is AAPL diluted EPS in FY2024?', class: 'numeric' },
  { q: 'Tell me about Tesla', class: 'summary' },
  { q: 'hi can you help me out?', class: 'colloquial' },
];

const VALID_CLASSES = new Set([
  'exact_lookup',
  'factoid',
  'relational',
  'analytical',
  'multi_part',
  'numeric',
  'summary',
  'colloquial',
]);

function buildLlmPrompt(query) {
  const ex = LLM_FEW_SHOT.map(
    (s) =>
      `Query: ${s.q}\nResponse: ${JSON.stringify({
        class: s.class,
        confidence: 1,
        reasoning: 'few-shot exemplar',
      })}`,
  ).join('\n\n');
  return `${ex}\n\nQuery: ${query}\nResponse:`;
}

function parseLlmResponse(raw, query) {
  if (!raw) return fallback('parse_failed:empty', query);
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) return fallback('parse_failed:no_json', query);
  try {
    const obj = JSON.parse(m[0]);
    const cls = typeof obj.class === 'string' ? obj.class : '';
    if (!VALID_CLASSES.has(cls)) return fallback(`parse_failed:bad_class:${cls}`, query);
    let confidence = Number(obj.confidence ?? 0.5);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.max(0, Math.min(1, confidence));
    return {
      class: cls,
      confidence,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
    };
  } catch (err) {
    return fallback(`parse_failed:${err?.message ?? 'unknown'}`, query);
  }
}

function fallback(reason, query) {
  return {
    class: 'factoid',
    confidence: 0,
    reasoning: `${reason} for "${query.slice(0, 80)}"`,
    parseFallback: true,
  };
}

async function callOpenRouter(query, apiKey, model) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const body = {
    model,
    temperature: 0,
    max_tokens: 200,
    messages: [
      { role: 'system', content: LLM_SYSTEM_PROMPT },
      { role: 'user', content: buildLlmPrompt(query) },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://finsentinel.local/eval-runner',
      'X-Title': 'finsentinel-classifier-shadow',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`openrouter ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? '';
  const usage = json?.usage ?? {};
  return { content, usage };
}

// ── Metrics helpers ─────────────────────────────────────────────────────────

function emptyClassMap(classes) {
  return Object.fromEntries(classes.map((c) => [c, 0]));
}

function computeMetrics(predictions, golden, allClasses) {
  const tp = emptyClassMap(allClasses);
  const fp = emptyClassMap(allClasses);
  const fn = emptyClassMap(allClasses);
  const confusion = {};
  let correct = 0;

  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const gold = golden[i];
    if (pred === gold) {
      correct += 1;
      tp[pred] = (tp[pred] ?? 0) + 1;
    } else {
      fp[pred] = (fp[pred] ?? 0) + 1;
      fn[gold] = (fn[gold] ?? 0) + 1;
      const k = `${gold}__to__${pred}`;
      confusion[k] = (confusion[k] ?? 0) + 1;
    }
  }

  const precision = {};
  const recall = {};
  for (const c of allClasses) {
    const denomP = (tp[c] ?? 0) + (fp[c] ?? 0);
    const denomR = (tp[c] ?? 0) + (fn[c] ?? 0);
    precision[c] = denomP === 0 ? null : round((tp[c] ?? 0) / denomP);
    recall[c] = denomR === 0 ? null : round((tp[c] ?? 0) / denomR);
  }

  return {
    accuracy_overall: round(correct / predictions.length),
    correct,
    n: predictions.length,
    per_class_precision: precision,
    per_class_recall: recall,
    confusion,
  };
}

function round(x) {
  return Math.round(x * 10000) / 10000;
}

function topConfusion(confusion, k = 3) {
  return Object.entries(confusion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([key, count]) => ({ pair: key, count }));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();

  const ruleClasses = [
    'exact_lookup',
    'factoid',
    'relational',
    'analytical',
    'multi_part',
    'numeric',
    'summary',
    'colloquial',
  ];
  const goldenClassSet = new Set(entries.map((e) => e.query_class).filter(Boolean));
  const allClasses = Array.from(new Set([...ruleClasses, ...goldenClassSet]));

  const golden = entries.map((e) => e.query_class);
  const ruleResults = entries.map((e) => classifyByRules(e.query));
  const rulePredictions = ruleResults.map((r) => r.class);

  // Vocabulary gap: classes that appear in golden but the rule layer can never emit.
  const missingInRules = Array.from(goldenClassSet).filter((c) => !ruleClasses.includes(c));

  let llmReport = null;
  let usageTotals = null;
  let llmRaw = null;
  let llmPredictions = null;

  if (useLlm) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      fatal('OPENROUTER_API_KEY not set; cannot run --llm. Re-run without --llm or export the key.');
    }
    if (entries.length > 50 && !yes) {
      console.warn(
        `WARN: --llm with N=${entries.length} will issue ${entries.length} OpenRouter calls. ` +
          `Estimated cost ~ $0.05–0.20 depending on model. Pass --yes to suppress this warning. Proceeding.`,
      );
    } else {
      console.log(`Running LLM eval against ${entries.length} entries with model=${llmModel}.`);
    }

    const llmResults = [];
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    llmRaw = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      try {
        const { content, usage: u } = await callOpenRouter(e.query, apiKey, llmModel);
        usage.prompt_tokens += u.prompt_tokens ?? 0;
        usage.completion_tokens += u.completion_tokens ?? 0;
        usage.total_tokens += u.total_tokens ?? 0;
        const parsed = parseLlmResponse(content, e.query);
        llmResults.push(parsed);
        llmRaw.push({ id: e.id, raw_first_120: String(content).slice(0, 120) });
      } catch (err) {
        llmResults.push(fallback(`llm_error:${err?.message ?? 'unknown'}`, e.query));
        llmRaw.push({ id: e.id, raw_first_120: `ERROR:${err?.message ?? 'unknown'}`.slice(0, 120) });
      }
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`  llm progress: ${i + 1}/${entries.length}\n`);
      }
    }

    llmPredictions = llmResults.map((r) => r.class);
    const llmMetrics = computeMetrics(llmPredictions, golden, allClasses);
    // Truncate reasoning per plan concern #3 (keep report under 200 KB).
    const sampleReasons = llmResults
      .slice(0, 20)
      .map((r, i) => ({
        id: entries[i].id,
        class: r.class,
        confidence: r.confidence,
        reasoning_truncated: (r.reasoning ?? '').slice(0, 120),
      }));
    llmReport = {
      ...llmMetrics,
      parse_fallback_count: llmResults.filter((r) => r.parseFallback).length,
      sample_reasoning_first_20: sampleReasons,
    };
    usageTotals = usage;
  }

  const ruleMetrics = computeMetrics(rulePredictions, golden, allClasses);

  let rulesVsLlm = null;
  if (useLlm && llmPredictions) {
    let agree = 0;
    for (let i = 0; i < llmPredictions.length; i++) {
      if (llmPredictions[i] === rulePredictions[i]) agree += 1;
    }
    rulesVsLlm = round(agree / llmPredictions.length);
  }

  const ranAtMs = Date.now();
  const report = {
    schema: 'classifier-shadow-v2',
    schema_version: 'v2',
    phase: '1.5',
    dataset: datasetPath,
    dataset_version: meta?.version ?? dataset?.version ?? 'unknown',
    n_total: allEntries.length,
    n_evaluated: entries.length,
    classes_emitted_by_rules: ruleClasses,
    classes_in_golden: Array.from(goldenClassSet).sort(),
    rules: {
      ...ruleMetrics,
      vocabulary_gap: { missing_in_rules: missingInRules, blast_radius_n: countMissing(golden, missingInRules) },
      top_confusion_pairs: topConfusion(ruleMetrics.confusion, 5),
    },
    llm: useLlm
      ? {
          model: llmModel,
          ...llmReport,
          top_confusion_pairs: topConfusion(llmReport.confusion, 5),
          usage_totals: usageTotals,
          agreement_with_rules: rulesVsLlm,
        }
      : null,
    wall_clock_ms: ranAtMs - startedAt,
    ran_at: new Date(ranAtMs).toISOString(),
    notes: [
      'Phase 1.5 offline shadow eval — rule logic is duplicated inline in this script.',
      'See apps/api/src/rag/__tests__/query-classifier-rules.spec.ts for the canonical behavioural test.',
      'Vocabulary closed: numeric + summary now emitted by rules.',
      'exact_lookup triple-gate fallback (ticker + time anchor + doc-type) was tightened — only whitelisted-ticker single-gate or section/numeric/quoted-phrase paths fire now.',
    ],
  };

  ensureDir(dirname(resolve(repoRoot, outPath)));
  writeFileSync(resolve(repoRoot, outPath), JSON.stringify(report, null, 2));

  printSummary(report);
}

function countMissing(golden, missing) {
  const set = new Set(missing);
  return golden.filter((g) => set.has(g)).length;
}

function printSummary(report) {
  console.log('');
  console.log('── Classifier Shadow Eval ──');
  console.log(`dataset:           ${report.dataset} (v${report.dataset_version})`);
  console.log(`n_evaluated:       ${report.n_evaluated} / ${report.n_total}`);
  console.log(`classes_in_golden: ${report.classes_in_golden.join(', ')}`);
  console.log('');
  console.log('rules:');
  console.log(`  accuracy_overall: ${report.rules.accuracy_overall}`);
  console.log(`  vocabulary_gap:   missing=${report.rules.vocabulary_gap.missing_in_rules.join(',') || '(none)'}, blast_radius_n=${report.rules.vocabulary_gap.blast_radius_n}`);
  console.log(`  per_class_precision: ${JSON.stringify(report.rules.per_class_precision)}`);
  console.log(`  per_class_recall:    ${JSON.stringify(report.rules.per_class_recall)}`);
  console.log(`  top_confusion:    ${JSON.stringify(report.rules.top_confusion_pairs)}`);
  if (report.llm) {
    console.log('');
    console.log(`llm (${report.llm.model}):`);
    console.log(`  accuracy_overall: ${report.llm.accuracy_overall}`);
    console.log(`  parse_fallbacks:  ${report.llm.parse_fallback_count}`);
    console.log(`  per_class_precision: ${JSON.stringify(report.llm.per_class_precision)}`);
    console.log(`  per_class_recall:    ${JSON.stringify(report.llm.per_class_recall)}`);
    console.log(`  top_confusion:    ${JSON.stringify(report.llm.top_confusion_pairs)}`);
    console.log(`  usage_totals:     ${JSON.stringify(report.llm.usage_totals)}`);
  }
  console.log('');
  console.log(`report:            ${outPath}`);
  console.log(`wall_clock_ms:     ${report.wall_clock_ms}`);
}

// ── Utilities ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const map = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        map.set(a.slice(0, eq), a.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
          map.set(a, true);
        } else {
          map.set(a, next);
          i += 1;
        }
      }
    }
  }
  return {
    has(k) {
      return map.has(k);
    },
    get(k) {
      const v = map.get(k);
      return v === true ? undefined : v;
    },
  };
}

function readJson(path, optional = false) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (optional) return null;
    fatal(`failed to read ${path}: ${err?.message ?? err}`);
  }
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function fatal(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
