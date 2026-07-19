import { Resend } from 'resend';
import { statusDot } from '../../src/utils/statusHelpers.js';
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

// Renders as a single bolded line for one incident, or a bullet list for several —
// callers always pass at least one title (falling back to the raw incident id in
// the rare case a title couldn't be resolved).
function renderIncidentTitles(incidentTitles: string[]): string {
  if (incidentTitles.length === 1) {
    return `<p><strong>${escapeHtml(incidentTitles[0])}</strong></p>`;
  }
  return `<ul>${incidentTitles.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
}

function incidentSubjectFragment(incidentTitles: string[]): string {
  return incidentTitles.length === 1 ? incidentTitles[0] : `${incidentTitles.length} incidents`;
}

export async function sendOutageNotificationEmail(
  to: string,
  name: string,
  providerDisplayName: string,
  status: StatusLevel,
  incidentTitles: string[],
  dashboardUrl: string,
  manageUrl: string,
  unsubscribeUrl: string
): Promise<boolean> {
  const statusLabel = STATUS_LABELS[status] ?? status;
  const dot = statusDot(status);
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `${dot} ${providerDisplayName}: ${incidentSubjectFragment(incidentTitles)}`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>${dot} <strong>${escapeHtml(providerDisplayName)}</strong> just started reporting <strong>${escapeHtml(statusLabel)}</strong>:</p>
      ${renderIncidentTitles(incidentTitles)}
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
  incidentTitles: string[],
  dashboardUrl: string,
  manageUrl: string,
  unsubscribeUrl: string
): Promise<boolean> {
  const stillOngoing = currentStatus !== 'operational';
  const statusLabel = STATUS_LABELS[currentStatus] ?? currentStatus;
  // Fixed "resolved" icon rather than statusDot(currentStatus) — this email reports
  // the resolved incident's outcome, not the provider's overall live status, so a
  // red/yellow dot next to "has been resolved" read as a contradiction even though
  // the "still reporting X" note below explains it. See feedback_email_no_emoji memory.
  const resolvedIcon = '✅';
  const intro = stillOngoing
    ? `The following, affecting <strong>${escapeHtml(providerDisplayName)}</strong>, ${incidentTitles.length === 1 ? 'has' : 'have'} been resolved. Note: ${escapeHtml(providerDisplayName)} is still reporting <strong>${escapeHtml(statusLabel)}</strong> due to other ongoing issues:`
    : `<strong>${escapeHtml(providerDisplayName)}</strong> has resolved the following and is back to normal operations:`;

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: stillOngoing
      ? `${resolvedIcon} ${providerDisplayName}: resolved — ${incidentSubjectFragment(incidentTitles)}`
      : `${resolvedIcon} ${providerDisplayName} is back to normal — ${incidentSubjectFragment(incidentTitles)}`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>${resolvedIcon} ${intro}</p>
      ${renderIncidentTitles(incidentTitles)}
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
