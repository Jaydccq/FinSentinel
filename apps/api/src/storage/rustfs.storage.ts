import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageService } from './interfaces/storage-service';

/**
 * RustFS (S3-compatible) storage service — hot tier.
 *
 * Uses @aws-sdk/client-s3 to interact with a RustFS/MinIO/S3 endpoint.
 * Configured via environment variables:
 * - RUSTFS_ENDPOINT, RUSTFS_ACCESS_KEY, RUSTFS_SECRET_KEY, RUSTFS_BUCKET
 */
@Injectable()
export class RustfsStorageService implements StorageService {
  private readonly logger = new Logger(RustfsStorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(configService: ConfigService) {
    this.bucket = configService.get<string>('RUSTFS_BUCKET', 'finsentinel');
    this.client = new S3Client({
      endpoint: configService.get<string>('RUSTFS_ENDPOINT', 'http://localhost:9000'),
      region: 'us-east-1',
      credentials: {
        accessKeyId: configService.get<string>('RUSTFS_ACCESS_KEY', 'minioadmin'),
        secretAccessKey: configService.get<string>('RUSTFS_SECRET_KEY', 'minioadmin'),
      },
      forcePathStyle: true,
    });
  }

  async upload(key: string, content: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
      }),
    );
    this.logger.debug(`Uploaded ${key} (${content.length} bytes) to RustFS`);
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    const stream = response.Body;
    if (!stream) {
      throw new Error(`Empty response body for key: ${key}`);
    }

    // Convert stream to Buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    this.logger.debug(`Deleted ${key} from RustFS`);
  }

  async createPresignedUploadUrl(
    key: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    // The two presigner/client packages can pin slightly different
    // `@smithy/types` minors and TypeScript then sees incompatible
    // middleware shapes. Runtime is fine — cast through `any` for both
    // arguments rather than forcing a `resolutions` bump.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.client as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getSignedUrl(client, cmd as any, { expiresIn: ttlSeconds });
  }

  async head(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (err) {
      // S3 + compatible servers return 404 (NotFound / NoSuchKey) for
      // missing objects; any other error is propagated because it's
      // ambiguous (auth, network, server) and the reconciler must not
      // treat "unknown" as "missing".
      const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } }).name;
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
        return false;
      }
      throw err;
    }
  }
}
