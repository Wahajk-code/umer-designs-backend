import { renderEmail } from '@/modules/mail/email-template';

describe('renderEmail', () => {
  it('escapes HTML special characters in heading and body', () => {
    const { html } = renderEmail({
      heading: '<script>alert(1)</script>',
      body: 'A & B < C > D "quoted" \'single\'',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;quoted&quot;');
  });

  it('converts newlines in the body to <br /> for the HTML version only', () => {
    const { html, text } = renderEmail({ heading: 'Hi', body: 'Line one\nLine two' });
    expect(html).toContain('Line one<br />Line two');
    expect(text).toContain('Line one\nLine two');
  });

  it('omits the CTA block entirely when no ctaUrl/ctaLabel is given', () => {
    const { html } = renderEmail({ heading: 'Hi', body: 'Body' });
    expect(html).not.toContain('<a href=');
  });

  it('escapes the CTA label but leaves the CTA URL as given', () => {
    const { html } = renderEmail({
      heading: 'Hi',
      body: 'Body',
      ctaLabel: '<b>Click</b>',
      ctaUrl: 'https://example.com/path?a=1&b=2',
    });
    expect(html).toContain('&lt;b&gt;Click&lt;/b&gt;');
    expect(html).toContain('href="https://example.com/path?a=1&b=2"');
  });
});
