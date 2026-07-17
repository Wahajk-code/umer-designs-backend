import { maskEmail } from '@/modules/referrals/referral-email.util';

describe('maskEmail', () => {
  it('keeps the first character and domain, masks the rest', () => {
    expect(maskEmail('sofia@example.com')).toBe('s****@example.com');
  });

  it('handles very short local parts without an empty mask', () => {
    expect(maskEmail('jo@example.com')).toBe('j***@example.com');
  });

  it('returns the input unchanged if it has no @ (defensive)', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});
