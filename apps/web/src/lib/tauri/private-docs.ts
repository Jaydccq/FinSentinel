import { isTauri } from './is-tauri';

export interface SearchHit {
  chunk_id: string;
  document_id: string;
  file_name: string;
  content: string;
  distance: number;
}

export interface DocumentSummary {
  id: string;
  file_name: string;
  page_count: number | null;
  indexed_at: number | null;
}

async function invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri command "${cmd}" called in non-Tauri environment`);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export const privateDocs = {
  async indexPdf(path: string): Promise<string> {
    return invokeCommand<string>('index_pdf', { path });
  },
  async search(query: string, topK = 5): Promise<SearchHit[]> {
    return invokeCommand<SearchHit[]>('search_private_docs', { query, topK });
  },
  async list(): Promise<DocumentSummary[]> {
    return invokeCommand<DocumentSummary[]>('list_documents');
  },
  isAvailable(): boolean {
    return isTauri();
  },
};
