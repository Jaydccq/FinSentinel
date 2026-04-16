import type { SearchHit } from '../tauri/private-docs';

export interface CloudHit {
  id: string;
  content: string;
  score: number;
  [k: string]: unknown;
}

export interface HybridHit {
  id: string;
  content: string;
  score: number;
  provenance: 'local' | 'cloud';
  raw: CloudHit | SearchHit;
}

export interface HybridSearchInput {
  query: string;
  topK: number;
  cloudSearch: (q: string, k: number) => Promise<CloudHit[]>;
  localSearch: (q: string, k: number) => Promise<SearchHit[]>;
  localAvailable: boolean;
}

function localToHybrid(h: SearchHit): HybridHit {
  const sim = Math.max(0, Math.min(1, 1 - h.distance));
  return { id: h.chunk_id, content: h.content, score: sim, provenance: 'local', raw: h };
}

function cloudToHybrid(h: CloudHit): HybridHit {
  return { id: h.id, content: h.content, score: h.score, provenance: 'cloud', raw: h };
}

export async function hybridSearch(input: HybridSearchInput): Promise<HybridHit[]> {
  const { query, topK, cloudSearch, localSearch, localAvailable } = input;

  const cloudPromise = cloudSearch(query, topK).catch(() => [] as CloudHit[]);
  const localPromise = localAvailable
    ? localSearch(query, topK).catch(() => [] as SearchHit[])
    : Promise.resolve<SearchHit[]>([]);

  const [cloudHits, localHits] = await Promise.all([cloudPromise, localPromise]);

  return [
    ...cloudHits.map(cloudToHybrid),
    ...localHits.map(localToHybrid),
  ].sort((a, b) => b.score - a.score);
}
