import { Resend } from 'resend';
import type { Provider, StatusLevel } from '../../src/types/status.js';

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM = `Cloud Status Hub Alerts <alerts@${process.env.RESEND_EMAIL_DOMAIN}>`;

export async function sendConfirmationEmail(to: string, name: string, confirmUrl: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Confirm your Cloud Status Hub subscription',
    html: renderLayout({
      accent: ACCENT.neutral,
      eyebrow: 'Subscription',
      heading: 'Confirm your subscription',
      body: `
        ${paragraph(`Hi ${escapeHtml(name)},`)}
        ${paragraph('Confirm your subscription to Cloud Status Hub alerts to start receiving outage notifications for the cloud providers you selected.')}
        ${button(confirmUrl, 'Confirm subscription')}
        ${note("If you didn't request this, you can ignore this email — you won't be subscribed unless you click the button above.")}
      `,
    }),
  });
}

export async function sendUpdateConfirmationEmail(to: string, name: string, confirmUrl: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Confirm changes to your Cloud Status Hub subscription',
    html: renderLayout({
      accent: ACCENT.neutral,
      eyebrow: 'Subscription',
      heading: 'Confirm your changes',
      body: `
        ${paragraph(`Hi ${escapeHtml(name)},`)}
        ${paragraph('Someone (hopefully you) requested a change to which providers you get alerts for. Your current subscription stays active until you confirm the change.')}
        ${button(confirmUrl, 'Confirm changes')}
        ${note("If you didn't request this, you can ignore this email — no changes will be made unless you click the button above.")}
      `,
    }),
  });
}

export async function sendWelcomeEmail(to: string, name: string, manageUrl: string, unsubscribeUrl: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: "You're subscribed to Cloud Status Hub alerts",
    html: renderLayout({
      accent: ACCENT.neutral,
      eyebrow: 'Subscription',
      heading: "You're subscribed",
      body: `
        ${paragraph(`Hi ${escapeHtml(name)},`)}
        ${paragraph("You're all set — we'll email you when a provider you follow reports a new outage, and again when it's resolved.")}
      `,
      manageUrl,
      unsubscribeUrl,
    }),
  });
}

const STATUS_LABELS: Record<string, string> = {
  degraded: 'degraded performance',
  outage: 'an outage',
  unknown: 'an unknown status',
};

export interface EmailIncident {
  id: string;
  title: string;
  regions: string[];
}

// Brief generation is async/fire-and-forget and hasn't run yet at the
// moment this email is sent (see README.md's Alerts & Admin section) — this
// links to a stable dashboard deep-link that resolves whatever's available
// whenever the email is actually opened, rather than a PDF/brief snapshot
// taken at send time (which would almost always be empty for a brand-new
// incident). Returns null when APP_BASE_URL isn't configured, so the caller
// can omit the line entirely rather than emit a bare "/?...".
function briefUrl(base: string, providerKey: Provider, incidentId: string): string | null {
  if (!base) return null;
  return `${base}/?${new URLSearchParams({ provider: providerKey, incidentId }).toString()}`;
}

// No regions parsed (or the fetcher explicitly labeled it "global"/unscoped) reads
// as a worldwide incident, not a missing-data gap — so it renders as "Global" rather
// than being silently dropped from the email.
function formatRegions(regions: string[]): string {
  if (regions.length === 0 || regions.some((r) => r.toLowerCase() === 'global')) {
    return 'Global';
  }
  return regions.join(', ');
}

// One card per incident: title, affected region(s) so subscribers don't have to
// click through to find out scope, and a per-incident link to its AI brief on the
// dashboard when one is available. Callers always pass at least one incident
// (falling back to the raw incident id as the title if one couldn't be resolved).
function renderIncidentCards(incidents: EmailIncident[], providerKey: Provider, base: string): string {
  return incidents
    .map((i) => {
      const url = briefUrl(base, providerKey, i.id);
      const regionLabel = i.regions.length > 1 ? `Regions (${i.regions.length})` : 'Region';
      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid ${COLOR.border};border-radius:6px;background:${COLOR.cardBg};">
          <tr><td style="padding:14px 16px;">
            <p style="margin:0 0 8px;font-family:${FONT};font-size:${SIZE.body};line-height:1.4;font-weight:600;color:${COLOR.text};">${escapeHtml(i.title)}</p>
            <p style="margin:0;font-family:${FONT};font-size:${SIZE.small};line-height:1.5;color:${COLOR.muted};"><span style="font-weight:600;color:${COLOR.text};">${regionLabel}:</span> ${escapeHtml(formatRegions(i.regions))}</p>
            ${url ? `<p style="margin:10px 0 0;font-family:${FONT};font-size:${SIZE.small};line-height:1.5;"><a href="${escapeHtml(url)}" style="color:${COLOR.link};font-weight:600;text-decoration:none;">View AI analysis &rarr;</a></p>` : ''}
          </td></tr>
        </table>`;
    })
    .join('');
}

function incidentSubjectFragment(incidents: EmailIncident[]): string {
  return incidents.length === 1 ? incidents[0].title : `${incidents.length} incidents`;
}

// Shown once in the body so recipients can see how fresh the notification is
// without cross-referencing pubDate/updated fields per incident. Fixed to UTC
// rather than the server's local time so it reads the same for every recipient.
function formatEmailTimestamp(date: Date = new Date()): string {
  const formatted = date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  return `${formatted} UTC`;
}

export async function sendOutageNotificationEmail(
  to: string,
  name: string,
  providerKey: Provider,
  providerDisplayName: string,
  status: StatusLevel,
  incidents: EmailIncident[],
  dashboardUrl: string,
  manageUrl: string,
  unsubscribeUrl: string
): Promise<boolean> {
  const statusLabel = STATUS_LABELS[status] ?? status;
  // Fixed "new incident" icon — the opposite/symmetric counterpart to the fixed
  // ✅ used in sendResolutionNotificationEmail — rather than statusDot(status),
  // so subject iconography reads as a simple started/resolved pair. Icon only
  // appears in the subject; the body would just be repeating it. See
  // feedback_email_no_emoji memory.
  const newIncidentIcon = '❌';
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `${newIncidentIcon} ${providerDisplayName}: ${incidentSubjectFragment(incidents)}`,
    html: renderLayout({
      accent: ACCENT.outage,
      eyebrow: incidents.length === 1 ? 'New incident' : `${incidents.length} new incidents`,
      heading: `${escapeHtml(providerDisplayName)} is reporting ${escapeHtml(statusLabel)}`,
      sentAt: formatEmailTimestamp(),
      body: `
        ${paragraph(`Hi ${escapeHtml(name)},`)}
        ${paragraph(`<strong>${escapeHtml(providerDisplayName)}</strong> just started reporting <strong>${escapeHtml(statusLabel)}</strong>:`)}
        ${renderIncidentCards(incidents, providerKey, dashboardUrl)}
        ${button(dashboardUrl, 'View on Cloud Status Hub')}
        ${note('From the dashboard you can click through to the official provider status page.')}
      `,
      manageUrl,
      unsubscribeUrl,
    }),
  });

  if (error) {
    console.error('sendOutageNotificationEmail failed', error);
    return false;
  }
  return true;
}

export async function sendResolutionNotificationEmail(
  to: string,
  name: string,
  providerKey: Provider,
  providerDisplayName: string,
  currentStatus: StatusLevel,
  incidents: EmailIncident[],
  dashboardUrl: string,
  manageUrl: string,
  unsubscribeUrl: string
): Promise<boolean> {
  const stillOngoing = currentStatus !== 'operational';
  const statusLabel = STATUS_LABELS[currentStatus] ?? currentStatus;
  // Fixed "resolved" icon rather than statusDot(currentStatus) — this email reports
  // the resolved incident's outcome, not the provider's overall live status, so a
  // red/yellow dot next to "has been resolved" read as a contradiction even though
  // the "still reporting X" note below explains it. Icon only appears in the
  // subject; the body would just be repeating it. See feedback_email_no_emoji memory.
  const resolvedIcon = '✅';
  const intro = stillOngoing
    ? `The following, affecting <strong>${escapeHtml(providerDisplayName)}</strong>, ${incidents.length === 1 ? 'has' : 'have'} been resolved. Note: ${escapeHtml(providerDisplayName)} is still reporting <strong>${escapeHtml(statusLabel)}</strong> due to other ongoing issues:`
    : `<strong>${escapeHtml(providerDisplayName)}</strong> has resolved the following and is back to normal operations:`;

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: stillOngoing
      ? `${resolvedIcon} ${providerDisplayName}: resolved — ${incidentSubjectFragment(incidents)}`
      : `${resolvedIcon} ${providerDisplayName} is back to normal — ${incidentSubjectFragment(incidents)}`,
    html: renderLayout({
      accent: ACCENT.resolved,
      eyebrow: incidents.length === 1 ? 'Resolved' : `${incidents.length} incidents resolved`,
      heading: stillOngoing
        ? `${escapeHtml(providerDisplayName)}: ${incidents.length === 1 ? 'incident' : 'incidents'} resolved`
        : `${escapeHtml(providerDisplayName)} is back to normal`,
      sentAt: formatEmailTimestamp(),
      body: `
        ${paragraph(`Hi ${escapeHtml(name)},`)}
        ${paragraph(intro)}
        ${renderIncidentCards(incidents, providerKey, dashboardUrl)}
        ${button(dashboardUrl, 'View on Cloud Status Hub')}
        ${note('From the dashboard you can click through to the official provider status page.')}
      `,
      manageUrl,
      unsubscribeUrl,
    }),
  });

  if (error) {
    console.error('sendResolutionNotificationEmail failed', error);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Shared layout. Email clients ignore <style> blocks unevenly and fall back to
// their own default font size for any element that doesn't set one, so every
// text element sets font-family/size/line-height inline from this one scale:
// heading 20px, body 15px, small (regions, links, notes) 13px, footer 12px.
// Table-based layout because Outlook doesn't support max-width on <div>.
// ---------------------------------------------------------------------------

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SIZE = { heading: '20px', body: '15px', small: '13px', footer: '12px' } as const;
const COLOR = {
  text: '#1f2937',
  muted: '#4b5563',
  faint: '#6b7280',
  border: '#e5e7eb',
  cardBg: '#f9fafb',
  pageBg: '#f3f4f6',
  link: '#2563eb',
} as const;
const ACCENT = { outage: '#dc2626', resolved: '#16a34a', neutral: '#2563eb' } as const;

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:${SIZE.body};line-height:1.6;color:${COLOR.text};">${html}</p>`;
}

function note(html: string): string {
  return `<p style="margin:0;font-family:${FONT};font-size:${SIZE.small};line-height:1.5;color:${COLOR.faint};">${html}</p>`;
}

function button(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;">
      <tr><td style="border-radius:6px;background:${COLOR.link};">
        <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 20px;font-family:${FONT};font-size:${SIZE.body};font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
      </td></tr>
    </table>`;
}

interface LayoutOptions {
  accent: string;
  eyebrow: string;
  /** Already HTML-escaped. */
  heading: string;
  body: string;
  sentAt?: string;
  manageUrl?: string;
  unsubscribeUrl?: string;
}

function renderLayout({ accent, eyebrow, heading, body, sentAt, manageUrl, unsubscribeUrl }: LayoutOptions): string {
  const footerLinks =
    manageUrl && unsubscribeUrl
      ? `<a href="${escapeHtml(manageUrl)}" style="color:${COLOR.faint};text-decoration:underline;">Manage your subscription</a> &middot; <a href="${escapeHtml(unsubscribeUrl)}" style="color:${COLOR.faint};text-decoration:underline;">Unsubscribe</a>`
      : '';
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${COLOR.pageBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.pageBg};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${COLOR.border};border-top:4px solid ${accent};border-radius:8px;">
      <tr><td style="padding:24px 28px 8px;">
        <p style="margin:0 0 6px;font-family:${FONT};font-size:${SIZE.footer};line-height:1.4;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${accent};">${escapeHtml(eyebrow)}</p>
        <p style="margin:0 0 ${sentAt ? '4px' : '20px'};font-family:${FONT};font-size:${SIZE.heading};line-height:1.3;font-weight:700;color:${COLOR.text};">${heading}</p>
        ${sentAt ? `<p style="margin:0 0 20px;font-family:${FONT};font-size:${SIZE.small};line-height:1.5;color:${COLOR.faint};">Sent ${escapeHtml(sentAt)}</p>` : ''}
        ${body}
      </td></tr>
      <tr><td style="padding:16px 28px 24px;">
        <p style="margin:0;padding-top:16px;border-top:1px solid ${COLOR.border};font-family:${FONT};font-size:${SIZE.footer};line-height:1.6;color:${COLOR.faint};">
          Cloud Status Hub${footerLinks ? `<br/>${footerLinks}` : ''}
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
