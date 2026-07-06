import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM = `CSP Status Hub Alerts <alerts@${process.env.RESEND_EMAIL_DOMAIN}>`;

export async function sendConfirmationEmail(to: string, name: string, confirmUrl: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Confirm your CSP Status Hub subscription',
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Confirm your subscription to CSP Status Hub alerts to start receiving outage notifications for the cloud providers you selected.</p>
      <p><a href="${confirmUrl}">Confirm subscription</a></p>
      <p>If you didn't request this, you can ignore this email — you won't be subscribed unless you click the link above.</p>
    `,
  });
}

export async function sendUpdateConfirmationEmail(to: string, name: string, confirmUrl: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Confirm changes to your CSP Status Hub subscription',
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
    subject: "You're subscribed to CSP Status Hub alerts",
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

export async function sendOutageNotificationEmail(
  to: string,
  name: string,
  providerDisplayName: string,
  status: string,
  sourceUrl: string,
  manageUrl: string,
  unsubscribeUrl: string
): Promise<boolean> {
  const statusLabel = STATUS_LABELS[status] ?? status;
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `${providerDisplayName} is reporting ${statusLabel}`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p><strong>${escapeHtml(providerDisplayName)}</strong> just started reporting <strong>${escapeHtml(statusLabel)}</strong>.</p>
      <p><a href="${sourceUrl}">View the official status page</a></p>
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
