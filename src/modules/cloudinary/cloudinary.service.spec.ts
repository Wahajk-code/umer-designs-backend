import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudinaryService } from '@/modules/cloudinary/cloudinary.service';
import { AppConfig } from '@/config/configuration';

function makeConfig(cloudinary: Partial<AppConfig['cloudinary']>): ConfigService<AppConfig, true> {
  return {
    get: (key: string) => {
      if (key === 'cloudinary') {
        return {
          cloudName: '',
          apiKey: '',
          apiSecret: '',
          signedUrlTtlSeconds: 300,
          ...cloudinary,
        };
      }
      throw new Error(`unexpected key ${key}`);
    },
  } as unknown as ConfigService<AppConfig, true>;
}

describe('CloudinaryService', () => {
  it('reports not configured when credentials are missing', () => {
    const service = new CloudinaryService(makeConfig({}));
    expect(service.isConfigured()).toBe(false);
  });

  it('reports configured when all three credentials are present', () => {
    const service = new CloudinaryService(
      makeConfig({ cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' }),
    );
    expect(service.isConfigured()).toBe(true);
  });

  it('throws a clear 503 (not a crash) when an upload signature is requested without credentials', () => {
    const service = new CloudinaryService(makeConfig({}));
    expect(() => service.createUploadSignature('designs/d1')).toThrow(ServiceUnavailableException);
  });

  it('throws a clear 503 when a signed download URL is requested without credentials', () => {
    const service = new CloudinaryService(makeConfig({}));
    expect(() => service.createSignedDownloadUrl('designs/d1/plan', 'raw', 'pdf')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws a clear 503 when asset deletion is requested without credentials', async () => {
    const service = new CloudinaryService(makeConfig({}));
    await expect(service.deleteAsset('designs/d1/plan', 'raw')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
