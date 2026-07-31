import { Resend } from 'resend';
import type { StatusLevel } from '../../src/types/status.js';

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM = `Cloud Status Hub Alerts <alerts@${process.env.RESEND_EMAIL_DOMAIN}>`;

export async function sendConfirmationEmail(to: string, name: string, confirmUrl: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Confirm your Cloud Status Hub subscription',
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Confirm your subscription to Cloud Status Hub alerts to start receiving outage notifications for the cloud providers you selected.</p>
      <p><a href="${confirmUrl}">Confirm subscription</a></p>
      <p>If you didn't request this, you can ignore this email — you won't be subscribed unless you click the link above.</p>
    `,
  });
}

export async function sendUpdateConfirmationEmail(to: string, name: string, confirmUrl: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Confirm changes to your Cloud Status Hub subscription',
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Someone (hopefully you) requested a change to which providers you get alerts for. Your current subscription stays active until you confirm the change.</p>
      <p><a href="${confirmUrl}">Confirm changes</a></p>
      <p>If you didn't request this, you can ignore this email — no changes will be made unless you click the link above.</p>
    `,
  });
}

export async function sendWelcomeEmail(to: string, name: string, manageUrl: string, unsubscribeUrl: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: "You're subscribed to Cloud Status Hub alerts",
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>You're all set — we'll email you when a provider you follow reports a new outage.</p>
      <p><a href="${manageUrl}">Manage your subscription</a></p>
      <p><a href="${unsubscribeUrl}">Unsubscribe</a></p>
    `,
  });
}

const STATUS_LABELS: Record<string, string> = {
  degraded: 'degraded performance',
  outage: 'an outage',
  unknown: 'an unknown status',
};

export interface EmailIncident {
  title: string;
  regions: string[];
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

// Renders as a single bolded line for one incident, or a bullet list for several —
// callers always pass at least one title (falling back to the raw incident id in
// the rare case a title couldn't be resolved). Each line is followed by the
// affected region(s) so subscribers don't have to click through to find out scope.
function renderIncidentTitles(incidents: EmailIncident[]): string {
  if (incidents.length === 1) {
    return `<p><strong>${escapeHtml(incidents[0].title)}</strong><br/><span style="color:#666;font-size:13px;">Region(s): ${escapeHtml(formatRegions(incidents[0].regions))}</span></p>`;
  }
  return `<ul>${incidents
    .map(
      (i) =>
        `<li><strong>${escapeHtml(i.title)}</strong><br/><span style="color:#666;font-size:13px;">Region(s): ${escapeHtml(formatRegions(i.regions))}</span></li>`
    )
    .join('')}</ul>`;
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
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p><strong>${escapeHtml(providerDisplayName)}</strong> just started reporting <strong>${escapeHtml(statusLabel)}</strong>:</p>
      <p style="margin:0 0 16px;font-size:12px;color:#888;">Sent ${formatEmailTimestamp()}</p>
      ${renderIncidentTitles(incidents)}
      <p><a href="${dashboardUrl}">View on Cloud Status Hub</a> — from there you can click through to the official status page.</p>
      <p style="margin-top:24px;font-size:12px;color:#666;">
        <a href="${manageUrl}">Manage your subscription</a> ·
        <a href="${unsubscribeUrl}">Unsubscribe</a>
      </p>
    `,
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
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>${intro}</p>
      <p style="margin:0 0 16px;font-size:12px;color:#888;">Sent ${formatEmailTimestamp()}</p>
      ${renderIncidentTitles(incidents)}
      <p><a href="${dashboardUrl}">View on Cloud Status Hub</a> — from there you can click through to the official status page.</p>
      <p style="margin-top:24px;font-size:12px;color:#666;">
        <a href="${manageUrl}">Manage your subscription</a> ·
        <a href="${unsubscribeUrl}">Unsubscribe</a>
      </p>
    `,
  });

  if (error) {
    console.error('sendResolutionNotificationEmail failed', error);
    return false;
  }
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
