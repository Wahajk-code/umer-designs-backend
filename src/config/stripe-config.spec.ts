import { resolveStripeConfig } from './stripe-config';

describe('resolveStripeConfig', () => {
  const both = {
    STRIPE_SECRET_KEY_TEST: 'rk_test_aaa',
    STRIPE_SECRET_KEY_LIVE: 'rk_live_bbb',
    STRIPE_PUBLISHABLE_KEY_TEST: 'pk_test_aaa',
    STRIPE_PUBLISHABLE_KEY_LIVE: 'pk_live_bbb',
  };

  it('defaults to test mode outside production and picks the _TEST keys', () => {
    const cfg = resolveStripeConfig({ ...both, NODE_ENV: 'development' });
    expect(cfg).toEqual({
      mode: 'test',
      secretKey: 'rk_test_aaa',
      publishableKey: 'pk_test_aaa',
      localConfirm: false,
    });
  });

  it('defaults to live mode in production and picks the _LIVE keys', () => {
    const cfg = resolveStripeConfig({ ...both, NODE_ENV: 'production' });
    expect(cfg).toEqual({
      mode: 'live',
      secretKey: 'rk_live_bbb',
      publishableKey: 'pk_live_bbb',
      localConfirm: false,
    });
  });

  it('lets STRIPE_MODE override the NODE_ENV default', () => {
    const cfg = resolveStripeConfig({ ...both, NODE_ENV: 'production', STRIPE_MODE: 'test' });
    expect(cfg.mode).toBe('test');
    expect(cfg.secretKey).toBe('rk_test_aaa');
  });

  it('falls back to the plain STRIPE_SECRET_KEY', () => {
    const cfg = resolveStripeConfig({ NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_test_plain' });
    expect(cfg.secretKey).toBe('sk_test_plain');
  });

  it('returns empty keys (feature disabled, app still boots) when nothing is set', () => {
    expect(resolveStripeConfig({ NODE_ENV: 'development' })).toEqual({
      mode: 'test',
      secretKey: '',
      publishableKey: '',
      localConfirm: false,
    });
  });

  it('refuses a live key while in test mode', () => {
    expect(() =>
      resolveStripeConfig({ NODE_ENV: 'development', STRIPE_SECRET_KEY: 'rk_live_oops' }),
    ).toThrow(/does not match STRIPE_MODE="test"/);
  });

  it('refuses a test key while in live mode', () => {
    expect(() =>
      resolveStripeConfig({ NODE_ENV: 'production', STRIPE_SECRET_KEY_LIVE: 'sk_test_oops' }),
    ).toThrow(/does not match STRIPE_MODE="live"/);
  });

  it('enables local confirm only in test mode, outside production, when flagged', () => {
    const on = { ...both, STRIPE_LOCAL_CONFIRM: 'true' };
    expect(resolveStripeConfig({ ...on, NODE_ENV: 'development' }).localConfirm).toBe(true);
    expect(resolveStripeConfig({ ...both, NODE_ENV: 'development' }).localConfirm).toBe(false);
    // never in production, even if the flag is left on and STRIPE_MODE=test
    expect(resolveStripeConfig({ ...on, NODE_ENV: 'production', STRIPE_MODE: 'test' }).localConfirm).toBe(false);
    // never in live mode
    expect(resolveStripeConfig({ ...on, NODE_ENV: 'development', STRIPE_MODE: 'live' }).localConfirm).toBe(false);
  });

  it('rejects an invalid STRIPE_MODE', () => {
    expect(() => resolveStripeConfig({ STRIPE_MODE: 'staging' })).toThrow(/must be "test" or "live"/);
  });
});
