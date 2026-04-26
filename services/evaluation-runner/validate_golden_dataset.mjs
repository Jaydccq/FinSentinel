import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const args = parseArgs(process.argv.slice(2));

const datasetPath = args.get('--dataset') ?? 'services/evaluation-runner/datasets/golden.json';
const corpusPath = args.get('--corpus') ?? 'services/evaluation-runner/datasets/corpus.json';
const metaPath = args.get('--meta') ?? 'services/evaluation-runner/datasets/golden.meta.json';

const dataset = readJson(datasetPath);
const corpus = readJson(corpusPath);
const meta = readJson(metaPath, true);

const chunks = new Set(corpus.chunks.map((chunk) => chunk.chunk_id));
const ids = new Set();
const sourceQueryLogIds = new Set();
const errors = [];
const piiPatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\b(?:sk|pk|rk|org|proj)_[A-Za-z0-9_-]{16,}\b/,
  /\b\d{3}[-.) ]?\d{3}[-. ]?\d{4}\b/,
];

if (!Array.isArray(dataset.entries)) {
  errors.push('dataset.entries must be an array');
} else {
  for (const entry of dataset.entries) {
    if (!entry.id) {
      errors.push('entry missing id');
      continue;
    }

    if (ids.has(entry.id)) {
      errors.push(`duplicate id ${entry.id}`);
    }
    ids.add(entry.id);

    if (entry.source_query_log_id) {
      if (sourceQueryLogIds.has(entry.source_query_log_id)) {
        errors.push(`duplicate source_query_log_id ${entry.source_query_log_id}`);
      }
      sourceQueryLogIds.add(entry.source_query_log_id);
    }

    if (!Array.isArray(entry.expected_chunk_ids) || entry.expected_chunk_ids.length === 0) {
      errors.push(`empty expected_chunk_ids ${entry.id}`);
    }

    for (const chunkId of entry.expected_chunk_ids ?? []) {
      if (!chunks.has(chunkId)) {
        errors.push(`missing corpus chunk ${entry.id} ${chunkId}`);
      }
    }

    if (!entry.expected_answer || !entry.expected_answer.trim()) {
      errors.push(`empty expected_answer ${entry.id}`);
    }

    const piiText = [entry.query, entry.expected_answer, JSON.stringify(entry.metadata ?? {})].join(' ');
    for (const pattern of piiPatterns) {
      if (pattern.test(piiText)) {
        errors.push(`regex-detectable PII ${entry.id}`);
      }
    }
  }
}

if (meta) {
  if (typeof meta.entry_count === 'number' && meta.entry_count !== dataset.entries.length) {
    errors.push(`meta.entry_count ${meta.entry_count} != dataset entries ${dataset.entries.length}`);
  }
  if (meta.version && dataset.version && meta.version !== dataset.version) {
    errors.push(`meta.version ${meta.version} != dataset.version ${dataset.version}`);
  }
}

const summary = {
  dataset: datasetPath,
  corpus: corpusPath,
  meta: meta ? metaPath : null,
  version: dataset.version,
  meta_version: meta?.version,
  entries: dataset.entries.length,
  meta_entry_count: meta?.entry_count,
  corpus_chunks: chunks.size,
  promoted_reviewed: dataset.entries.filter(
    (entry) => entry.provenance_label === 'local_api_promoted_reviewed',
  ).length,
  corrected_existing: meta?.v2_2_review?.existing_rows_corrected?.length ?? 0,
  unique_ids: ids.size,
  unique_source_query_log_ids: sourceQueryLogIds.size,
  errors,
};

console.log(JSON.stringify(summary, null, 2));

if (errors.length > 0) {
  process.exit(1);
}

function readJson(path, optional = false) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  } catch (error) {
    if (optional && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed.set(token, 'true');
      continue;
    }

    parsed.set(token, next);
    index += 1;
  }
  return parsed;
}
