// Email dispatch via nodemailer SMTP.
// Graceful degradation: if SMTP env vars missing, logs warning and skips send.
// Never throws — all errors are caught and logged.

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../config/env';

let _transporter: Transporter | null = null;
let _transporterChecked = false;

function getTransporter(): Transporter | null {
  if (_transporterChecked) return _transporter;
  _transporterChecked = true;

  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    console.info('[email] SMTP not configured — email notifications disabled');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host:   env.SMTP_HOST,
    port:   env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE === 'true', // true = port 465 TLS, false = STARTTLS
    auth:   { user: env.SMTP_USER, pass: env.SMTP_PASS },
    pool:   true,           // reuse connections
    maxConnections: 5,
    rateDelta: 1000,
    rateLimit: 5,           // max 5 messages per second
  });

  return _transporter;
}

export function isEmailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

/**
 * Send a single HTML email. Fire-and-forget safe: awaited internally
 * but this function itself never throws. All errors are caught + logged.
 */
export async function sendEmail(
  to:      string,
  subject: string,
  html:    string,
): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) return;

  try {
    await transporter.sendMail({
      from:    env.EMAIL_FROM ?? 'RINGO <noreply@example.com>',
      to,
      subject,
      html,
      // Plain-text fallback — strip tags for clients that prefer it
      text: html.replace(/<[^>]+>/g, '').replace(/\s{2,}/g, ' ').trim(),
    });
  } catch (err) {
    // Never propagate — notification failure must not crash the approval flow
    console.error(`[email] send to ${to} failed:`, err);
  }
}
