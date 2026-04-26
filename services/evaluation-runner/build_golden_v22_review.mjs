import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

const corpus = readJson('services/evaluation-runner/datasets/corpus.json');
const golden = readJson('services/evaluation-runner/datasets/golden.json');
const meta = readJson('services/evaluation-runner/datasets/golden.meta.json');
const promotedFile = readJson('/tmp/staging-rag-promote.json', true);
const promotedMeta = readJson('/tmp/staging-rag-promote.meta.json', true);

const alreadyPromoted = golden.entries.filter(
  (entry) =>
    entry.provenance_label === 'local_api_promoted_reviewed' ||
    entry.provenance_label === 'real_user_promoted',
);

if (alreadyPromoted.length > 0) {
  throw new Error(
    `Canonical golden set already contains ${alreadyPromoted.length} promoted rows; rerun this one-off builder only from the v2.1 100-row base.`,
  );
}

const chunks = new Map(corpus.chunks.map((chunk) => [chunk.chunk_id, chunk]));
const uuidToCorpus = new Map(
  corpus.chunks.map((chunk) => [
    sha256Uuid('finsentinel:corpus-fixture:chunk-id', chunk.chunk_id),
    chunk.chunk_id,
  ]),
);

const labels = [
  label(
    'apple_free_cash_returns',
    /apple.*(free cash flow|cash flow).*return.*shareholder|what did apple make.*pay shareholder|apple shareholder returns.*cash flow/,
    'multi_part',
    ['chunk-005'],
    'Apple generated $118.3 billion in operating cash flow and $107.2 billion in free cash flow in FY2025, and returned $95.0 billion to shareholders through dividends and buybacks.',
    ['Apple Inc.', 'free cash flow', 'shareholder returns'],
    'easy',
    ['chunk-001'],
  ),
  label(
    'apple_services_growth',
    /apple.*services growth|aapl fy2025 services revenue|apple services revenue/,
    'factoid',
    ['chunk-001', 'chunk-002'],
    'Apple Services revenue reached $96.2 billion in FY2025, up from $84.3 billion in FY2024, supported by App Store, iCloud, Apple Music, Apple TV+, Apple Pay, AppleCare, advertising, and a 2.3 billion device installed base.',
    ['Apple Inc.', 'Services'],
    'easy',
  ),
  label(
    'apple_q3_revenue',
    /aapl q3.*revenue|apple q3.*revenue/,
    'exact_lookup',
    ['chunk-008'],
    'Apple reported Q3 FY2025 revenue of $94.8 billion for the quarter ended June 2025, up 4.9% year over year.',
    ['Apple Inc.'],
    'easy',
  ),
  label(
    'apple_revenue_services',
    /apple revenue.*services|apple.*revenue.*services sales|apple fy2025.*revenue.*iphone.*services.*cash|table: apple fy2025/,
    'multi_part',
    ['chunk-001', 'chunk-002', 'chunk-005'],
    'Apple FY2025 revenue was $391.0 billion, including $200.6 billion of iPhone revenue and $96.2 billion of Services revenue; free cash flow was $107.2 billion.',
    ['Apple Inc.', 'iPhone', 'Services', 'free cash flow'],
    'easy',
  ),
  label(
    'apple_total_revenue',
    /aapl fy2025 revenue$|how much money did apple|apple.*total revenue|what share of apple.*iphone|apple.*fy2025 revenue/,
    'exact_lookup',
    ['chunk-001'],
    'Apple reported FY2025 total revenue of $391.0 billion; iPhone revenue was $200.6 billion, or 51.3% of total revenue.',
    ['Apple Inc.', 'iPhone'],
    'easy',
    ['chunk-002'],
  ),
  label(
    'apple_devices',
    /apple devices|installed base/,
    'exact_lookup',
    ['chunk-002'],
    "Apple's installed base of active devices surpassed 2.3 billion globally.",
    ['Apple Inc.', 'installed base'],
    'easy',
  ),
  label(
    'apple_india_production',
    /india.*iphone production/,
    'exact_lookup',
    ['chunk-004'],
    'India accounted for about 14% of global iPhone production in FY2025, up from 7% in the prior year.',
    ['Apple Inc.', 'India'],
    'easy',
  ),
  label(
    'apple_china',
    /greater china|apple.*huawei|china risk/,
    'relational',
    ['chunk-006'],
    'Apple Greater China revenue declined 2.8% to $67.4 billion amid Huawei and Xiaomi competition, regulatory pressure, and delayed Apple Intelligence approval.',
    ['Apple Inc.', 'Greater China', 'Huawei', 'Xiaomi'],
  ),
  label(
    'apple_growth_risks',
    /apple.*growth drivers.*risks|apple.*10-k.*revenue.*margin.*risks|apple.*performance.*revenue.*services.*risks.*cash/,
    'analytical',
    ['chunk-001', 'chunk-002', 'chunk-003', 'chunk-005', 'chunk-006'],
    'Apple FY2025 growth was driven by $391.0 billion of revenue, Services growth to $96.2 billion, and strong cash returns. Key risks were iPhone concentration, TSMC/East Asia supply-chain dependence, and Greater China/regulatory pressure.',
    ['Apple Inc.', 'Services', 'TSMC', 'Greater China'],
    'medium',
    ['chunk-004'],
  ),
  label(
    'apple_supply_chain',
    /apple.*supply chain|apple connected to tsmc|apple and tsmc|aapl.*tsmc/,
    'relational',
    ['chunk-004', 'chunk-029', 'chunk-031'],
    'Apple sources advanced A-series and M-series chips exclusively from TSMC leading-edge nodes, linking Apple to Taiwan concentration and advanced-chip supply-chain risk.',
    ['Apple Inc.', 'TSMC', 'Taiwan'],
    'medium',
    ['chunk-003'],
  ),
  label(
    'nvidia_total_revenue',
    /nvidia.*total sales|nvidia.*record revenue|nvda.*total revenue/,
    'exact_lookup',
    ['chunk-009'],
    'NVIDIA reported FY2025 revenue of $130.5 billion, up 114% year over year.',
    ['NVIDIA Corporation'],
    'easy',
  ),
  label(
    'nvidia_data_center_gaming',
    /nvidia.*data center.*gaming|nvda.*data center revenue|nvidia data center sales/,
    'multi_part',
    ['chunk-009', 'chunk-011'],
    'NVIDIA Data Center revenue was $115.2 billion in FY2025 and Gaming revenue was $10.6 billion; hyperscale cloud providers including Microsoft Azure, AWS, and Google Cloud represented about 45% of data-center revenue.',
    ['NVIDIA Corporation', 'Data Center', 'Gaming'],
    'easy',
  ),
  label(
    'nvidia_gross_margin',
    /nvidia.*gross margin|nvda fy2025 gross margin/,
    'exact_lookup',
    ['chunk-013'],
    "NVIDIA's FY2025 gross margin was 73.8%, compared with 72.7% in FY2024, helped by favorable data-center product mix.",
    ['NVIDIA Corporation', 'gross margin'],
    'easy',
  ),
  label(
    'nvidia_gpu_share',
    /ai gpu market|nvidia.*market share|gpu market does nvidia/,
    'exact_lookup',
    ['chunk-010'],
    'NVIDIA held an estimated 80-85% global share of AI training GPUs, supported by CUDA, NVLink/NVSwitch, and a full-stack AI platform.',
    ['NVIDIA Corporation', 'AI training GPUs', 'CUDA'],
    'easy',
  ),
  label(
    'nvidia_blackwell',
    /blackwell/,
    'factoid',
    ['chunk-011', 'chunk-030'],
    'NVIDIA Blackwell generated $18 billion in its first two quarters, while TSMC CoWoS capacity constrained shipments in the first half of 2025.',
    ['NVIDIA Corporation', 'Blackwell', 'TSMC CoWoS'],
  ),
  label(
    'nvidia_export_controls',
    /export controls.*(china|chip)|china chip development|nvidia.*china-region|china-region revenue/,
    'relational',
    ['chunk-032', 'chunk-013'],
    'US export controls tightened in 2025, cutting China-bound semiconductor exports by about $15 billion annually and reducing NVIDIA China-region revenue by an estimated $12 billion; China accelerated Huawei Ascend and SMIC domestic development.',
    ['NVIDIA Corporation', 'US export controls', 'China', 'Huawei Ascend', 'SMIC'],
  ),
  label(
    'nvidia_tsmc',
    /nvidia connected to tsmc|tsmc.*nvidia.*supply chain|nvidia.*tsmc|worried about tsmc for nvidia/,
    'relational',
    ['chunk-012', 'chunk-029', 'chunk-031'],
    'NVIDIA depends on TSMC for Hopper and Blackwell GPUs on advanced 4nm and 3nm nodes, creating Taiwan concentration and supply-chain risk because TSMC produces over 90% of sub-5nm chips.',
    ['NVIDIA Corporation', 'TSMC', 'Taiwan'],
  ),
  label(
    'nvidia_moat',
    /nvidia.*ai moat|nvidia.*competitive moat|nvidia.*10-k highlights|nvidia.*business and competitive/,
    'analytical',
    ['chunk-009', 'chunk-010', 'chunk-011', 'chunk-014'],
    "NVIDIA's FY2025 moat came from $115.2 billion of Data Center revenue, 80-85% AI training GPU share, CUDA's 5 million developers, hyperscaler demand, networking growth, and continued R&D investment.",
    ['NVIDIA Corporation', 'CUDA', 'Data Center', 'Blackwell'],
  ),
  label(
    'nvidia_vulnerabilities',
    /nvidia.*vulnerabilities|manufacturing and regulatory risks/,
    'analytical',
    ['chunk-012', 'chunk-013', 'chunk-031'],
    "NVIDIA's main vulnerabilities were TSMC single-source dependence, Taiwan geopolitical risk, capacity allocation, and US export controls that reduced China-region revenue.",
    ['NVIDIA Corporation', 'TSMC', 'US export controls'],
  ),
  label(
    'nvidia_msft_ai',
    /(microsoft|msft).*nvidia|(microsoft|msft).*ai capex|ai capex.*(cloud revenue|microsoft|msft|concern)|nvidia.*microsoft exposure|ai infrastructure demand/,
    'relational',
    ['chunk-022', 'chunk-011', 'chunk-021'],
    'Microsoft AI capex was directed to data centers and NVIDIA H100/Blackwell GPUs, while NVIDIA Data Center revenue was supported by hyperscale cloud providers including Microsoft Azure.',
    ['Microsoft Corporation', 'NVIDIA Corporation', 'Azure', 'Data Center'],
  ),
  label(
    'nvda_amd_ai_accelerators',
    /nvda vs amd|ai accelerators/,
    'relational',
    ['chunk-010', 'chunk-030', 'chunk-032'],
    "The corpus supports NVIDIA's dominant AI accelerator position through 80-85% AI training GPU share and an AI accelerator market growing 85% to $95 billion; AMD appears in the export-control/supply-chain context but has no detailed revenue-share row in this corpus.",
    ['NVIDIA Corporation', 'AMD', 'AI accelerators'],
  ),
  label(
    'tesla_total_vehicle',
    /tsla fy2025 total revenue|tsla fy2025 automotive revenue|vehicle deliveries|tesla q4 deliveries/,
    'exact_lookup',
    ['chunk-015'],
    'Tesla reported FY2025 revenue of $97.7 billion and delivered 1.95 million vehicles globally; automotive gross margin was 18.2%.',
    ['Tesla Inc.'],
    'easy',
  ),
  label(
    'tesla_auto_energy',
    /tesla.*automotive revenue.*energy|tesla automotive revenue.*energy storage|tesla.*energy storage revenue|tesla energy.*revenue/,
    'multi_part',
    ['chunk-015', 'chunk-018'],
    'Tesla Automotive revenue was $78.5 billion and Energy Generation and Storage revenue was $12.1 billion in FY2025; Tesla Energy deployed 32 GWh and reached 28.5% gross margin.',
    ['Tesla Inc.', 'Automotive', 'Energy Storage'],
    'easy',
  ),
  label(
    'tesla_byd_ev',
    /tesla.*byd|byd.*tesla|tesla.*ev leader|tsla losing ground|global ev market|ev market sales|ev market growth|ev market size|ev subsidies/,
    'relational',
    ['chunk-016', 'chunk-019'],
    'BYD surpassed Tesla in total EV sales volume in 2025 with 3.2 million units, while Tesla delivered 1.95 million vehicles and its global BEV share fell to 15.8%; the global BEV market reached 18.5 million units, led by China.',
    ['Tesla Inc.', 'BYD', 'global EV market', 'China'],
  ),
  label(
    'tesla_mixed',
    /tesla.*mixed performance|tesla.*auto.*competition.*autonomy|tesla.*10-k.*autonomy|tesla.*key.*numbers|tesla.*revenue.*deliveries.*margins/,
    'analytical',
    ['chunk-015', 'chunk-016', 'chunk-017', 'chunk-018'],
    'Tesla grew FY2025 revenue to $97.7 billion and delivered 1.95 million vehicles, but automotive gross margin was pressured by competition; energy storage grew strongly and autonomy/robotaxi deployment expanded.',
    ['Tesla Inc.', 'BYD', 'Tesla Energy', 'FSD'],
    'medium',
    ['chunk-019'],
  ),
  label(
    'msft_total_revenue',
    /msft fy2025 total revenue|microsoft.*total revenue/,
    'exact_lookup',
    ['chunk-020'],
    'Microsoft reported FY2025 total revenue of $264.2 billion, up 16% year over year.',
    ['Microsoft Corporation'],
    'easy',
  ),
  label(
    'msft_azure_growth',
    /msft fy2025 azure growth|azure growth|microsoft cloud revenue/,
    'exact_lookup',
    ['chunk-020', 'chunk-021'],
    'Azure and other cloud services revenue grew 29% year over year in FY2025; Azure AI services contributed about $15 billion annualized revenue.',
    ['Microsoft Corporation', 'Azure'],
    'easy',
  ),
  label(
    'msft_by_segment',
    /msft fy2025 by segment|microsoft.*segment revenue|microsoft fy2025 segment/,
    'factoid',
    ['chunk-020'],
    'Microsoft FY2025 segment revenue was Intelligent Cloud $110.4 billion, Productivity and Business Processes $85.7 billion, and More Personal Computing $68.1 billion; operating margin was 44.8%.',
    ['Microsoft Corporation', 'Intelligent Cloud', 'Azure'],
    'easy',
  ),
  label(
    'msft_azure_aws',
    /azure.*aws|aws.*azure|azure.*market share/,
    'relational',
    ['chunk-021'],
    'Azure was the second-largest cloud infrastructure provider with about 24% market share, behind AWS at 31%.',
    ['Microsoft Azure', 'AWS'],
    'easy',
  ),
  label(
    'msft_copilot',
    /copilot/,
    'exact_lookup',
    ['chunk-021'],
    'Copilot for Microsoft 365 reached 50 million monthly active users and contributed about $5 billion in annual revenue.',
    ['Microsoft Copilot', 'Microsoft 365'],
    'easy',
  ),
  label(
    'msft_cash_returns',
    /microsoft.*cash generation|microsoft.*shareholder returns|msft.*cash/,
    'factoid',
    ['chunk-023'],
    'Microsoft generated $89.4 billion in operating cash flow and returned $52.3 billion to shareholders through dividends and repurchases.',
    ['Microsoft Corporation'],
    'easy',
  ),
  label(
    'aapl_services_msft_cloud',
    /aapl.*services.*msft.*cloud|apple.*microsoft.*cash generation|apple and microsoft.*cash/,
    'relational',
    ['chunk-001', 'chunk-002', 'chunk-020', 'chunk-021', 'chunk-005', 'chunk-023'],
    'Apple Services revenue reached $96.2 billion while Microsoft Intelligent Cloud revenue was $110.4 billion and Azure grew 29%; both companies generated strong cash flow and shareholder returns.',
    ['Apple Inc.', 'Microsoft Corporation', 'Services', 'Azure'],
  ),
  label(
    'fed_rate_current',
    /fed funds rate|fomc.*maintained|current fed/,
    'exact_lookup',
    ['chunk-024'],
    'The FOMC maintained the federal funds target range at 4.25-4.50% at its June 2025 meeting.',
    ['Federal Reserve', 'FOMC'],
    'easy',
  ),
  label(
    'fed_core_pce',
    /core pce|unemployment rate/,
    'exact_lookup',
    ['chunk-024', 'chunk-027'],
    'Core PCE was 2.8% year over year, and the June 2025 FOMC minutes cited unemployment at 4.2%.',
    ['Federal Reserve', 'Core PCE'],
    'easy',
  ),
  label(
    'fed_dot_plot_gdp',
    /dot plot|gdp growth|rate cuts|fed project.*inflation.*gdp/,
    'multi_part',
    ['chunk-026', 'chunk-024', 'chunk-027'],
    'The June 2025 dot plot showed two 25 bp cuts by year-end and GDP growth projected at 2.1%; core PCE stood at 2.8%.',
    ['Federal Reserve', 'FOMC', 'GDP', 'Core PCE'],
  ),
  label(
    'fed_tech_valuations',
    /fed policy.*technology valuations|fed rate pressure.*tech.*banks|fed rates pressured|interest rates connected to bank earnings|rates.*tech valuation|rates still high/,
    'relational',
    ['chunk-024', 'chunk-025', 'chunk-028', 'chunk-041'],
    'Higher-for-longer Fed rates kept the target range at 4.25-4.50%, pressured growth-stock valuations, and supported bank net interest margins; large-cap tech partly offset pressure with cash flow and AI growth.',
    ['Federal Reserve', 'technology valuations', 'banks'],
  ),
  label(
    'jpm_net_income',
    /jpm.*net income|jpmorgan.*net income|jpm doing well/,
    'exact_lookup',
    ['chunk-039', 'chunk-040'],
    'JPMorgan reported FY2025 net income of $54.2 billion on $172.3 billion revenue, but commercial banking net charge-offs rose to $2.1 billion as CRE borrowers faced rate pressure.',
    ['JPMorgan Chase & Co.'],
    'easy',
  ),
  label(
    'jpm_cet1',
    /jpm.*cet1|cet1 capital/,
    'exact_lookup',
    ['chunk-039'],
    "JPMorgan's CET1 capital ratio was 15.3%, above the regulatory minimum of 11.4%.",
    ['JPMorgan Chase & Co.', 'CET1'],
    'easy',
  ),
  label(
    'jpm_credit_cre',
    /commercial real estate.*jpm|jpmorgan.*credit|jpm.*credit quality|cre credit|credit losses/,
    'relational',
    ['chunk-040', 'chunk-041', 'chunk-039'],
    'JPMorgan remained profitable with record net income, but credit quality weakened in CRE: commercial banking net charge-offs rose to $2.1 billion and the broader banking sector flagged 19.5% office vacancy.',
    ['JPMorgan Chase & Co.', 'commercial real estate', 'credit losses'],
  ),
  label(
    'jpm_numeric',
    /jpmorgan fy2025 revenue.*net income.*net interest|jpm.*net interest income/,
    'factoid',
    ['chunk-039', 'chunk-040'],
    'JPMorgan FY2025: revenue $172.3 billion; net income $54.2 billion; net interest income $92.8 billion; CET1 15.3%; net charge-offs $2.1 billion; allowance for credit losses $22.3 billion.',
    ['JPMorgan Chase & Co.'],
    'easy',
  ),
  label(
    'banking_strengths_risks',
    /banking sector strengths|bank earnings strength/,
    'analytical',
    ['chunk-039', 'chunk-040', 'chunk-041'],
    'Banks benefited from higher net interest margins and strong money-center earnings, while CRE exposure, deposit competition, and rising charge-offs remained key risks.',
    ['JPMorgan Chase & Co.', 'US banking sector', 'commercial real estate'],
  ),
  label(
    'jnj_total_revenue',
    /jnj fy2025 total revenue|johnson.*total revenue/,
    'exact_lookup',
    ['chunk-033'],
    'Johnson & Johnson reported FY2025 revenue of $88.7 billion after the Kenvue spinoff.',
    ['Johnson & Johnson'],
    'easy',
  ),
  label(
    'jnj_innovative_medtech',
    /jnj.*innovative medicine|innovative medicine.*medtech|johnson.*key drug/,
    'multi_part',
    ['chunk-033'],
    'Johnson & Johnson Innovative Medicine revenue was $58.4 billion and MedTech revenue was $30.3 billion; Darzalex reached $12.1 billion and Tremfya $4.8 billion.',
    ['Johnson & Johnson', 'Innovative Medicine', 'MedTech', 'Darzalex', 'Tremfya'],
    'easy',
  ),
  label(
    'pharma_glp1_patent',
    /glp-1|patent cliff|pharma.*trends|obesity drug market/,
    'relational',
    ['chunk-034', 'chunk-033', 'chunk-035'],
    'GLP-1 drugs dominated pharma trends with a $50 billion obesity-drug market, while the patent cliff threatened $120 billion in branded drug revenue; J&J still reported $58.4 billion of Innovative Medicine revenue.',
    ['GLP-1 receptor agonists', 'Johnson & Johnson', 'patent cliff'],
  ),
  label(
    'healthcare_defensive',
    /healthcare.*defensive/,
    'summary',
    ['chunk-035', 'chunk-034'],
    'Healthcare outperformed the S&P 500 in 2025 with defensive characteristics; pharma themes included GLP-1 growth and patent-cliff risk.',
    ['S&P 500 Health Care index', 'GLP-1'],
  ),
  label(
    'xom_revenue',
    /xom fy2025 total revenue|exxon.*total revenue/,
    'exact_lookup',
    ['chunk-036'],
    'Exxon Mobil reported FY2025 revenue of $334.5 billion.',
    ['Exxon Mobil Corporation'],
    'easy',
  ),
  label(
    'oil_price',
    /average oil price|brent/,
    'exact_lookup',
    ['chunk-037'],
    'Brent crude averaged $78 per barrel in 2025, within a $68-$88 range.',
    ['Brent crude'],
    'easy',
  ),
  label(
    'exxon_brent',
    /exxon.*brent|oil market outlook|energy sector valuation|exxon.*cash returns/,
    'summary',
    ['chunk-036', 'chunk-037', 'chunk-038'],
    'Exxon benefited from strong upstream earnings and cash flow while Brent averaged $78; integrated oil majors traded at discounted valuations with high free-cash-flow yields and dividend yields.',
    ['Exxon Mobil Corporation', 'Brent crude', 'integrated oil majors'],
  ),
  label(
    'tsmc_revenue_advanced_share',
    /tsmc 2025 revenue|tsm.*advanced-node|tsmc.*advanced chip|tsmc related to advanced chip/,
    'exact_lookup',
    ['chunk-029', 'chunk-031'],
    "TSMC produced over 90% of the world's sub-5nm advanced chips in 2025 and generated $95.2 billion of revenue, up 30% year over year.",
    ['TSMC', 'advanced chips'],
    'easy',
  ),
  label(
    'semiconductor_revenue',
    /global semiconductor industry revenue|semiconductor industry growth/,
    'exact_lookup',
    ['chunk-030'],
    'Global semiconductor revenue reached $680 billion in 2025, up 18%, while the AI accelerator market grew 85% to $95 billion.',
    ['semiconductor industry', 'AI accelerators'],
    'easy',
  ),
  label(
    'semiconductor_supply_chain',
    /semiconductor supply chain|semi supply chain|supply chain vulnerabilities|asml|neon gas|taiwan risk connected|which companies.*tsmc|tsmc risks.*companies|taiwan risks affect apple and nvidia/,
    'analytical',
    ['chunk-029', 'chunk-030', 'chunk-031', 'chunk-004', 'chunk-012'],
    'Semiconductor supply-chain risk centered on TSMC advanced-node concentration in Taiwan, ASML EUV dependency, neon gas exposure, and lack of viable alternatives for Apple, NVIDIA, AMD, and Qualcomm advanced chips.',
    ['TSMC', 'ASML', 'Apple Inc.', 'NVIDIA Corporation', 'AMD', 'Qualcomm'],
    'hard',
  ),
  label(
    'apple_cash_current',
    /apple.*cash.*2025 filing/,
    'exact_lookup',
    ['chunk-005'],
    'Apple held $51.2 billion in cash and marketable securities in FY2025 and generated $118.3 billion of operating cash flow.',
    ['Apple Inc.'],
    'easy',
  ),
];

const repairIds = new Set([
  'gs-044',
  'gs-051',
  'gs-053',
  'gs-054',
  'gs-055',
  'gs-057',
  'gs-061',
  'gs-064',
  'gs-065',
  'gs-071',
  'gs-074',
  'gs-091',
  'gs-092',
  'gs-094',
]);

const repairedOriginal = golden.entries.map((entry) => {
  if (!repairIds.has(entry.id)) return entry;
  const fixed = reviewEntry(entry, 'synthetic_review_corrected');
  fixed.previous_expected_chunk_ids = entry.expected_chunk_ids;
  fixed.previous_expected_answer = entry.expected_answer;
  fixed.previous_query_class = entry.query_class;
  fixed.correction_note =
    'Corrected during v2.2 review because the existing query/chunk/answer tuple pointed at the wrong corpus topic.';
  return fixed;
});

const promotedRows = promotedFile.entries.filter(
  (entry) => entry.provenance_label === 'real_user_promoted',
);

if (promotedRows.length !== 100) {
  throw new Error(`Expected 100 promoted rows, found ${promotedRows.length}`);
}

const reviewedPromoted = promotedRows.map((entry) => reviewEntry(entry, 'local_api_promoted'));
const worksheet = reviewedPromoted.map((entry) => ({
  id: entry.id,
  source_query_log_id: entry.source_query_log_id,
  query: entry.query,
  query_class: entry.query_class,
  promoted_expected_chunk_ids: entry.promoted_expected_chunk_ids,
  promoted_expected_corpus_chunk_ids: entry.promoted_expected_corpus_chunk_ids,
  reviewer_decision: entry.reviewer_decision,
  reviewer_rule: entry.reviewer_rule,
  expected_chunk_ids: entry.expected_chunk_ids,
  acceptable_chunk_ids: entry.acceptable_chunk_ids,
  expected_source_docs: entry.expected_source_docs,
  expected_answer: entry.expected_answer,
  expected_entities: entry.expected_entities,
  difficulty: entry.difficulty,
  evidence: excerptsFor(entry.expected_chunk_ids),
}));

const candidate = {
  ...golden,
  version: '2.2',
  created_at: '2026-04-26',
  description:
    '200-entry RAG golden set (v2.2): v2.1 100-row corpus labels plus 100 local API promoted rows reviewed into corpus-native ground-truth chunk labels.',
  entries: [...repairedOriginal, ...reviewedPromoted],
};

const candidateMeta = {
  ...meta,
  version: '2.2',
  entry_count: candidate.entries.length,
  last_promoted_at: promotedMeta.last_promoted_at,
  labeler_primary: 'openai-codex',
  labeler_reviewer: 'openai-codex self-review per operator instruction',
  reviewer_sample_pct: 100,
  provenance_split: {
    reverse_engineered_synthetic: 70,
    natural_phrasing_synthetic: 30,
    local_api_promoted_reviewed: reviewedPromoted.length,
  },
  promotion_log: promotedMeta.promotion_log ?? [],
  bucket_distribution: countBy(candidate.entries, (entry) =>
    Array.isArray(entry.tags) ? entry.tags[0] : entry.query_class,
  ),
  query_class_distribution: countBy(candidate.entries, (entry) => entry.query_class),
  v2_2_review: {
    reviewed_at: '2026-04-26T00:00:00-04:00',
    reviewer: 'openai-codex',
    source_promotion_file: '/tmp/staging-rag-promote.json',
    review_worksheet: '/tmp/staging-rag-review-worksheet.json',
    candidate_file: '/tmp/golden-v2.2-candidate.json',
    promoted_rows_reviewed: reviewedPromoted.length,
    existing_rows_corrected: [...repairIds].sort(),
    note: 'Promoted UUID result_chunk_ids were converted to corpus chunk ids and replaced with reviewer-selected ground-truth chunks from corpus.json.',
  },
  validation_notes: [
    ...(Array.isArray(meta.validation_notes) ? meta.validation_notes : []),
    '2026-04-26 v2.2: Added 100 local API promoted rows after openai-codex review. Labels are corpus-native ground-truth chunk ids, not raw retrieval output UUIDs.',
    '2026-04-26 v2.2: Corrected 14 existing v2.1 rows whose query/chunk/answer tuples pointed at the wrong corpus topic.',
  ],
};

validateCandidate(candidate);

writeJson('/tmp/staging-rag-review-worksheet.json', {
  generated_at: '2026-04-26T00:00:00-04:00',
  rows: worksheet,
});
writeJson('/tmp/golden-v2.2-candidate.json', candidate);
writeJson('/tmp/golden-v2.2-candidate.meta.json', candidateMeta);

console.log(
  JSON.stringify(
    {
      candidate_entries: candidate.entries.length,
      reviewed_promoted: reviewedPromoted.length,
      repaired_original: repairIds.size,
      bucket_distribution: candidateMeta.bucket_distribution,
      query_class_distribution: candidateMeta.query_class_distribution,
      worksheet: '/tmp/staging-rag-review-worksheet.json',
      candidate: '/tmp/golden-v2.2-candidate.json',
      meta: '/tmp/golden-v2.2-candidate.meta.json',
    },
    null,
    2,
  ),
);

function readJson(path, absolute = false) {
  return JSON.parse(readFileSync(absolute ? path : resolve(root, path), 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function label(key, re, queryClass, chunkIds, answer, entities, difficulty = 'medium', acceptable = []) {
  return { key, re, queryClass, chunks: chunkIds, answer, entities, difficulty, acceptable };
}

function normalize(query) {
  return query
    .toLowerCase()
    .replace(/[']/g, "'")
    .replace(/—/g, '-')
    .replace(/\s+(in the fixture documents|using the corpus|with supporting chunks)$/i, '')
    .replace(/^please answer from the corpus:\s*/i, '')
    .replace(/^for 2025,\s*/i, '')
    .trim();
}

function labelFor(query) {
  const normalized = normalize(query);
  for (const candidateLabel of labels) {
    if (candidateLabel.re.test(normalized)) return candidateLabel;
  }
  throw new Error(`No label rule matched query: ${query}`);
}

function reviewEntry(entry, reason) {
  const matched = labelFor(entry.query);
  const expected = [...new Set(matched.chunks)];
  const acceptable = [...new Set(matched.acceptable.filter((id) => !expected.includes(id)))];
  for (const id of [...expected, ...acceptable]) {
    if (!chunks.has(id)) throw new Error(`Unknown chunk ${id} for ${entry.id}`);
  }

  const priorIds = Array.isArray(entry.expected_chunk_ids) ? entry.expected_chunk_ids : [];
  const priorCorpusIds = priorIds
    .map((id) => uuidToCorpus.get(id) ?? id)
    .filter((id) => chunks.has(id));

  const reviewed = {
    ...entry,
    query_class: matched.queryClass,
    expected_chunk_ids: expected,
    acceptable_chunk_ids: acceptable,
    expected_source_docs: sourceDocsFor(expected),
    expected_answer: matched.answer,
    expected_entities: matched.entities,
    difficulty: matched.difficulty,
    tags: [matched.queryClass, 'reviewed_ground_truth', reason],
    provenance_label:
      reason === 'local_api_promoted'
        ? 'local_api_promoted_reviewed'
        : (entry.provenance_label ?? 'synthetic_reviewed'),
    reviewed_at: '2026-04-26T00:00:00-04:00',
    reviewer: 'openai-codex',
    reviewer_decision: 'ground_truth_chunks_set_from_corpus',
    reviewer_rule: matched.key,
  };

  if (entry.source_query_log_id) reviewed.source_query_log_id = entry.source_query_log_id;
  if (entry.promoted_at) reviewed.promoted_at = entry.promoted_at;
  if (entry.redactions_applied) reviewed.redactions_applied = entry.redactions_applied;
  if (reason === 'local_api_promoted') {
    reviewed.promoted_expected_chunk_ids = priorIds;
    reviewed.promoted_expected_corpus_chunk_ids = [...new Set(priorCorpusIds)];
  }
  return reviewed;
}

function sourceDocsFor(ids) {
  return [...new Set(ids.map((id) => chunks.get(id)?.source_doc).filter(Boolean))];
}

function excerptsFor(ids) {
  return ids.map((id) => ({
    chunk_id: id,
    source_doc: chunks.get(id)?.source_doc ?? '',
    excerpt: (chunks.get(id)?.content ?? '').slice(0, 420),
  }));
}

function countBy(items, fn) {
  const counts = {};
  for (const item of items) {
    const key = fn(item) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function validateCandidate(candidateFile) {
  for (const entry of candidateFile.entries) {
    if (!entry.id || !entry.query || !entry.query_class) {
      throw new Error(`Malformed entry ${entry.id}`);
    }
    if (!Array.isArray(entry.expected_chunk_ids) || entry.expected_chunk_ids.length === 0) {
      throw new Error(`Entry ${entry.id} has no expected_chunk_ids`);
    }
    for (const id of entry.expected_chunk_ids) {
      if (!chunks.has(id)) throw new Error(`Entry ${entry.id} references unknown expected chunk ${id}`);
    }
    for (const id of entry.acceptable_chunk_ids ?? []) {
      if (!chunks.has(id)) {
        throw new Error(`Entry ${entry.id} references unknown acceptable chunk ${id}`);
      }
    }
    if (!entry.expected_answer || !entry.expected_answer.trim()) {
      throw new Error(`Entry ${entry.id} has empty expected_answer`);
    }
  }

  const ids = candidateFile.entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate entry ids');

  const sourceIds = candidateFile.entries
    .map((entry) => entry.source_query_log_id)
    .filter(Boolean);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error('Duplicate source_query_log_id');
  }

  const pii =
    /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(?:\b(?:sk|pk|ghp|nvapi)[-_][A-Z0-9_-]{16,})|(?:\+?\d[\d\s().-]{7,}\d)/i;
  const piiHits = candidateFile.entries.filter((entry) => pii.test(entry.query));
  if (piiHits.length) throw new Error(`PII regex hit: ${piiHits.map((entry) => entry.id).join(', ')}`);
}

function sha256Uuid(namespace, key) {
  const hash = createHash('sha256').update(`${namespace}\0${key}`).digest('hex');
  const variant = (parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8;
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${variant.toString(16)}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}
