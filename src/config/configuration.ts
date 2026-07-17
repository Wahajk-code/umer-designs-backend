export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresInDays: number;
  };
  internal: {
    hmacSecret: string;
    windowMs: number;
  };
  corsAllowedOrigin: string;
  bcryptSaltRounds: number;
  rateLimit: {
    auth: { ttlMs: number; limit: number };
    payment: { ttlMs: number; limit: number };
    default: { ttlMs: number; limit: number };
  };
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    signedUrlTtlSeconds: number;
  };
  stripe: {
    secretKey: string;
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  adminNotifyEmail: string;
  referralRewardCents: number;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '4000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresInDays: parseInt(process.env.JWT_REFRESH_EXPIRES_IN_DAYS ?? '7', 10),
  },
  internal: {
    hmacSecret: process.env.INTERNAL_HMAC_SECRET ?? '',
    windowMs: parseInt(process.env.INTERNAL_HMAC_WINDOW_MS ?? '60000', 10),
  },
  corsAllowedOrigin: process.env.CORS_ALLOWED_ORIGIN ?? '',
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
  rateLimit: {
    auth: {
      ttlMs: parseInt(process.env.AUTH_RATE_LIMIT_TTL_MS ?? '60000', 10),
      limit: parseInt(process.env.AUTH_RATE_LIMIT_LIMIT ?? '10', 10),
    },
    payment: {
      ttlMs: parseInt(process.env.PAYMENT_RATE_LIMIT_TTL_MS ?? '60000', 10),
      limit: parseInt(process.env.PAYMENT_RATE_LIMIT_LIMIT ?? '20', 10),
    },
    default: {
      ttlMs: parseInt(process.env.DEFAULT_RATE_LIMIT_TTL_MS ?? '60000', 10),
      limit: parseInt(process.env.DEFAULT_RATE_LIMIT_LIMIT ?? '120', 10),
    },
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
    signedUrlTtlSeconds: parseInt(process.env.CLOUDINARY_SIGNED_URL_TTL_SECONDS ?? '300', 10),
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'Umer Designs <no-reply@umerdesigns.example>',
  },
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL ?? '',
  referralRewardCents: parseInt(process.env.REFERRAL_REWARD_CENTS ?? '3000', 10),
});
