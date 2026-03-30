/**
 * Storage service interface — abstraction for hot (RustFS/S3) and cold (Google Drive) storage.
 */
export interface StorageService {
  /** Upload a file to storage. */
  upload(key: string, content: Buffer, contentType: string): Promise<void>;

  /** Download a file from storage. */
  download(key: string): Promise<Buffer>;

  /** Delete a file from storage. */
  delete(key: string): Promise<void>;
}
