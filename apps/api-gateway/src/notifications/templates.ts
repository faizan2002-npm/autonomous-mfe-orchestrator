export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Responsive, inline-styled layout (email clients ignore <style> blocks). */
function layout(heading: string, paragraphs: string[], action: { label: string; url: string }, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e3e5ec">
<tr><td style="padding:28px 28px 8px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b5bd6;font-weight:600">MFE Orchestrator</div>
<h1 style="margin:10px 0 0;font-size:20px;line-height:1.35">${escape(heading)}</h1></td></tr>
<tr><td style="padding:8px 28px">${paragraphs.map((p) => `<p style="margin:12px 0;font-size:15px;line-height:1.55;color:#40465a">${escape(p)}</p>`).join('')}</td></tr>
<tr><td style="padding:12px 28px 28px"><a href="${escape(action.url)}" style="display:inline-block;background:#5b5bd6;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:8px">${escape(action.label)}</a></td></tr>
</table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:1.5;color:#8a90a2">${escape(footer)}</p>
</td></tr></table></body></html>`;
}

export function notificationEmail(input: {
  orgName: string;
  title: string;
  body: string;
  url: string;
  settingsUrl: string;
}): RenderedEmail {
  return {
    subject: `[${input.orgName}] ${input.title}`,
    html: layout(input.title, [input.body], { label: 'Open in dashboard', url: input.url }, `You're receiving this as a member of ${input.orgName}. Change what you're notified about at ${input.settingsUrl}`),
    text: `${input.title}\n\n${input.body}\n\nOpen: ${input.url}\n\nNotification settings: ${input.settingsUrl}`,
  };
}

export function invitationEmail(input: {
  orgName: string;
  role: string;
  invitedBy: string;
  acceptUrl: string;
}): RenderedEmail {
  const title = `Join ${input.orgName} on MFE Orchestrator`;
  const body = `${input.invitedBy} invited you as ${input.role}. Reviewers watch API contract drift between services and approve the patches that heal it.`;
  return {
    subject: title,
    html: layout(title, [body, 'This link works once and expires in 7 days.'], { label: 'Accept invitation', url: input.acceptUrl }, `If you weren't expecting this, you can ignore it.`),
    text: `${title}\n\n${body}\n\nAccept: ${input.acceptUrl}\n\nThis link works once and expires in 7 days.`,
  };
}
