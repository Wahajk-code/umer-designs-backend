import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { AppConfig } from '@/config/configuration';

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

/**
 * Wraps Cloudinary so every other module depends on this, not the SDK
 * directly. Uploads go straight from the admin's browser to Cloudinary using
 * a short-lived signature from here — large binaries never transit our own
 * server. Purchased design files are delivered only via signed, expiring
 * URLs (never a permanent public link) — wired up when Orders (Phase 4)
 * grants access.
 */
@Injectable()
export class CloudinaryService {
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly signedUrlTtlSeconds: number;

  constructor(config: ConfigService<AppConfig, true>) {
    const c = config.get('cloudinary', { infer: true });
    this.cloudName = c.cloudName;
    this.apiKey = c.apiKey;
    this.apiSecret = c.apiSecret;
    this.signedUrlTtlSeconds = c.signedUrlTtlSeconds;

    if (this.isConfigured()) {
      cloudinary.config({
        cloud_name: this.cloudName,
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        secure: true,
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.cloudName && this.apiKey && this.apiSecret);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'File storage is not configured yet. Set CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.',
      );
    }
  }

  /** Signature the admin's browser uses to upload directly to Cloudinary as an `authenticated` (not public) asset. */
  createUploadSignature(folder: string): UploadSignature {
    this.assertConfigured();
    const timestamp = Math.round(Date.now() / 1000);
    const paramsToSign = { timestamp, folder, type: 'authenticated' };
    const signature = cloudinary.utils.api_sign_request(paramsToSign, this.apiSecret);
    return { cloudName: this.cloudName, apiKey: this.apiKey, timestamp, signature, folder };
  }

  /** Short-lived signed URL — never a permanent public link — for a purchased/owned file. */
  createSignedDownloadUrl(publicId: string, resourceType: string, format: string): string {
    this.assertConfigured();
    const expiresAt = Math.round(Date.now() / 1000) + this.signedUrlTtlSeconds;
    return cloudinary.utils.private_download_url(publicId, format, {
      resource_type: resourceType,
      type: 'authenticated',
      expires_at: expiresAt,
      attachment: true,
    });
  }

  async deleteAsset(publicId: string, resourceType: string): Promise<void> {
    this.assertConfigured();
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
    });
  }
}
