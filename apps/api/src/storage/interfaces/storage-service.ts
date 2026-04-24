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

  /**
   * Check whether a key exists without downloading bytes. Used by the
   * F-4 DocumentReconcilerService to decide between "PENDING_UPLOAD row
   * has a real storage object — promote to PENDING" and "no storage
   * object — delete the stuck row".
   */
  head(key: string): Promise<boolean>;

  /**
   * F-4 direct-upload: mint a short-lived presigned PUT URL so the
   * browser can stream bytes directly to storage instead of through
   * Node memory. Not every backend supports this — implementations
   * that don't should return `null`, and the controller falls back to
   * the multipart upload path.
   *
   * `ttlSeconds` bounds how long the URL is valid. Keep small
   * (default ~15 min) since large numbers invite replay and leak risk
   * if the URL is accidentally logged.
   */
  createPresignedUploadUrl?(
    key: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<string | null>;
}
