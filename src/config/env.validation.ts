import * as Joi from 'joi';

/**
 * Fail-fast schema: Nest refuses to boot if any required var is missing or malformed.
 * New modules append their own required keys here as they're built, rather than
 * validating ad-hoc inside services.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(4000),

  DATABASE_URL: Joi.string().uri().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN_DAYS: Joi.number().default(7),

  INTERNAL_HMAC_SECRET: Joi.string().min(32).required(),
  INTERNAL_HMAC_WINDOW_MS: Joi.number().default(60000),

  CORS_ALLOWED_ORIGIN: Joi.string().uri().required(),

  BCRYPT_SALT_ROUNDS: Joi.number().min(10).max(15).default(12),

  AUTH_RATE_LIMIT_TTL_MS: Joi.number().default(60000),
  AUTH_RATE_LIMIT_LIMIT: Joi.number().default(10),
  PAYMENT_RATE_LIMIT_TTL_MS: Joi.number().default(60000),
  PAYMENT_RATE_LIMIT_LIMIT: Joi.number().default(20),
  DEFAULT_RATE_LIMIT_TTL_MS: Joi.number().default(60000),
  DEFAULT_RATE_LIMIT_LIMIT: Joi.number().default(120),

  // Third-party integrations are intentionally NOT `.required()`: the app boots
  // and every other module works without them. A feature that needs one
  // fails clearly (503 "not configured") only when actually invoked — see
  // CloudinaryService/StripeService/MailService `isConfigured()`. Fill these
  // in for real before relying on uploads, payments, or email in production.
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').default(''),
  CLOUDINARY_API_KEY: Joi.string().allow('').default(''),
  CLOUDINARY_API_SECRET: Joi.string().allow('').default(''),
  CLOUDINARY_SIGNED_URL_TTL_SECONDS: Joi.number().default(300),

  STRIPE_SECRET_KEY: Joi.string().allow('').default(''),

  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().allow('').default('Umer Designs <no-reply@umerdesigns.example>'),
  ADMIN_NOTIFY_EMAIL: Joi.string().allow('').default(''),

  // Flat referral reward, platform-wide (no per-referral customization in this scope).
  REFERRAL_REWARD_CENTS: Joi.number().default(3000),
}).unknown(true);
