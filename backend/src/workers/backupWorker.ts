/**
 * Scheduled database backup worker.
 * Registers a cron job that runs backupService.runBackup() on schedule.
 * Default schedule: 02:00 daily (configurable via BACKUP_CRON env var).
 *
 * Sends email alert on failure if BACKUP_ALERT_EMAIL + SMTP configured.
 */

import cron from 'node-cron';
import { runBackup } from '../services/backupService';
import { env } from '../config/env';

// Only import mailer if SMTP is configured (it's optional)
async function sendFailureAlert(error: string): Promise<void> {
  if (!env.BACKUP_ALERT_EMAIL || !env.SMTP_HOST) return;
  try {
    const { createTransport } = await import('nodemailer');
    const transport = createTransport({
      host:   env.SMTP_HOST,
      port:   env.SMTP_PORT,
      secure: env.SMTP_SECURE === 'true',
      auth:   env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({
      from:    env.EMAIL_FROM ?? env.SMTP_USER,
      to:      env.BACKUP_ALERT_EMAIL,
      subject: '[RINGO] ⚠️ Database backup FAILED',
      text:    `Backup failed at ${new Date().toISOString()}\n\nError:\n${error}\n\nCheck server logs for details.`,
    });
    console.log(`[backup] Alert email sent to ${env.BACKUP_ALERT_EMAIL}`);
  } catch (mailErr) {
    console.error('[backup] Failed to send alert email:', mailErr);
  }
}

export function scheduleBackup(): void {
  if (!env.BACKUP_S3_BUCKET) {
    console.log('[backup] BACKUP_S3_BUCKET not set — backup worker disabled');
    return;
  }

  const schedule = env.BACKUP_CRON;
  if (!cron.validate(schedule)) {
    console.error(`[backup] Invalid BACKUP_CRON expression: "${schedule}" — worker not started`);
    return;
  }

  console.log(`[backup] Scheduled daily backup at cron "${schedule}" → s3://${env.BACKUP_S3_BUCKET}/${env.BACKUP_S3_PREFIX}/`);

  cron.schedule(schedule, async () => {
    console.log('[backup] Starting scheduled backup…');
    const result = await runBackup();
    if (!result.success) {
      await sendFailureAlert(result.error ?? 'Unknown error');
    }
  });
}
