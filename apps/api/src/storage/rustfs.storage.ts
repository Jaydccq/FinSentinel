import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
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
}
