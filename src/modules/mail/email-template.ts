interface EmailTemplateInput {
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/** All free-text fields flow through here before hitting the HTML — some originate from public, unauthenticated input (e.g. the contact form). */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One consistent branded shell for every transactional email. */
export function renderEmail({ heading, body, ctaLabel, ctaUrl }: EmailTemplateInput): {
  html: string;
  text: string;
} {
  const safeHeading = escapeHtml(heading);
  const safeBody = escapeHtml(body).replace(/\n/g, '<br />');
  const safeCtaLabel = ctaLabel ? escapeHtml(ctaLabel) : undefined;
  // ctaUrl is always either a same-origin path we built ourselves or an admin-supplied,
  // class-validator-checked URL (ConfirmMeetingDto) — never raw public free text.
  const cta =
    safeCtaLabel && ctaUrl
      ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:20px;background:#2b2c2c;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-size:13px;font-weight:500;">${safeCtaLabel}</a>`
      : '';

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px;overflow:hidden;">
          <tr>
            <td style="padding:32px 36px 8px;">
              <div style="font-size:12px;letter-spacing:0.2em;color:#2b2c2c;font-weight:500;">UMER DESIGNS</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 36px 8px;">
              <h1 style="margin:0;font-size:20px;font-weight:400;color:#2b2c2c;">${safeHeading}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 36px 32px;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#444646;">${safeBody}</p>
              ${cta}
            </td>
          </tr>
        </table>
        <p style="margin-top:20px;font-size:11px;color:#8a8d8f;">Umer Designs — Tending your visions into reality</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${heading}\n\n${body}${ctaUrl ? `\n\n${ctaLabel ?? 'View'}: ${ctaUrl}` : ''}`;

  return { html, text };
}
