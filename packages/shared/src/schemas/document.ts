import { z } from 'zod';
import { DocumentType, DocumentStatus, StorageTier } from '../enums';

const documentTypeValues = Object.values(DocumentType) as [string, ...string[]];
const documentStatusValues = Object.values(DocumentStatus) as [string, ...string[]];
const storageTierValues = Object.values(StorageTier) as [string, ...string[]];

// --- DocumentUploadResponse ---
export const documentUploadResponseSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  docType: z.enum(documentTypeValues),
  status: z.enum(documentStatusValues),
  sector: z.string(),
  regionId: z.string(),
  fileSize: z.number().int().nullable(),
  chunkCount: z.number().int().nullable(),
  storageTier: z.enum(storageTierValues),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type DocumentUploadResponse = z.infer<typeof documentUploadResponseSchema>;
