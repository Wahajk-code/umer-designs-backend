export type StripeMode = 'test' | 'live';

export interface StripeConfig {
  mode: StripeMode;
  /** Secret (sk_) or restricted (rk_) key, server-side only. */
  secretKey: string;
  /** pk_ key. Not used by hosted Checkout; exposed for a future embedded flow. */
  publishableKey: string;
  /**
   * Local-dev stand-in for the webhook (see CheckoutConfirmService). True only
   * when STRIPE_LOCAL_CONFIRM=true AND test mode AND not production.
   */
  localConfirm: boolean;
}

/**
 * Picks the Stripe credentials for the active mode so test and live keys can
 * sit side by side in one env file:
 *
 *   STRIPE_MODE=test|live          (default: live in production, else test)
 *   STRIPE_SECRET_KEY_TEST / _LIVE (falls back to plain STRIPE_SECRET_KEY)
 *   STRIPE_PUBLISHABLE_KEY_TEST / _LIVE (falls back to STRIPE_PUBLISHABLE_KEY)
 *
 * A key from the wrong mode is a hard boot error: it's far better to refuse to
 * start than to charge real cards from a dev machine (or test cards in prod).
 */
export function resolveStripeConfig(env: NodeJS.ProcessEnv): StripeConfig {
  const explicit = (env.STRIPE_MODE ?? '').trim().toLowerCase();
  if (explicit && explicit !== 'test' && explicit !== 'live') {
    throw new Error(`STRIPE_MODE must be "test" or "live" (got "${env.STRIPE_MODE}").`);
  }
  const mode: StripeMode = explicit
    ? (explicit as StripeMode)
    : env.NODE_ENV === 'production'
      ? 'live'
      : 'test';

  const suffix = mode.toUpperCase();
  const pick = (name: string): string => (env[`${name}_${suffix}`] || env[name] || '').trim();

  const secretKey = pick('STRIPE_SECRET_KEY');
  if (secretKey && !secretKey.startsWith(`sk_${mode}_`) && !secretKey.startsWith(`rk_${mode}_`)) {
    throw new Error(
      `Stripe secret key does not match STRIPE_MODE="${mode}" (expected sk_${mode}_… or rk_${mode}_…). ` +
        `Check STRIPE_SECRET_KEY_${suffix}.`,
    );
  }

  const publishableKey = pick('STRIPE_PUBLISHABLE_KEY');
  if (publishableKey && !publishableKey.startsWith(`pk_${mode}_`)) {
    throw new Error(
      `Stripe publishable key does not match STRIPE_MODE="${mode}" (expected pk_${mode}_…). ` +
        `Check STRIPE_PUBLISHABLE_KEY_${suffix}.`,
    );
  }

  const localConfirm =
    env.STRIPE_LOCAL_CONFIRM === 'true' && mode === 'test' && env.NODE_ENV !== 'production';

  return { mode, secretKey, publishableKey, localConfirm };
}
