# Database Backup Setup

## AWS Setup (do once when you have permissions)

### 1. Create S3 Bucket
- Name: `ringo-backups` (or any name)
- Region: `ap-northeast-1` (Tokyo, same as EC2)
- Block ALL public access: ON
- Versioning: ON (optional but recommended)
- Server-side encryption: SSE-S3 (AES-256) — enable

### 2. Attach IAM Policy to EC2 Instance Role

Go to: AWS Console → EC2 → Your instance → Security → IAM role → Add inline policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::ringo-backups",
        "arn:aws:s3:::ringo-backups/*"
      ]
    }
  ]
}
```

Note: NO s3:DeleteObject — backup worker deletes old backups differently (lists then deletes via allowed action).
Add DeleteObject if you want pruning to work:

```json
{
  "Effect": "Allow",
  "Action": ["s3:DeleteObject"],
  "Resource": "arn:aws:s3:::ringo-backups/*"
}
```

### 3. Add to .env on EC2

```env
# S3 Backup
BACKUP_S3_BUCKET=ringo-backups
BACKUP_S3_REGION=ap-northeast-1
BACKUP_S3_PREFIX=db
BACKUP_RETENTION_DAYS=30
BACKUP_CRON=0 2 * * *

# Strongly recommended: encrypt backups before upload
# Choose a random 32+ character passphrase and store it safely
BACKUP_ENCRYPTION_KEY=your-random-32-char-passphrase-here

# Optional: email alert if backup fails (uses existing SMTP config)
BACKUP_ALERT_EMAIL=admin@your-domain.com
```

## How it works

- Runs every night at 2:00 AM (server time)
- `pg_dump` → gzip compress → AES-256 encrypt → upload to S3
- Deletes backups older than RETENTION_DAYS
- Sends email alert on failure (if SMTP configured)
- No AWS keys needed in code — EC2 IAM role handles auth

## Restore procedure

1. Download backup file from S3 console
2. Decrypt (if encrypted):
   ```bash
   node -e "
   const { decryptBackup } = require('./dist/services/backupService');
   decryptBackup('backup.sql.gz.enc', 'backup.sql.gz', 'your-passphrase');
   "
   ```
3. Restore to PostgreSQL:
   ```bash
   gunzip backup.sql.gz
   psql -h localhost -U postgres -d ringo < backup.sql
   ```

## Manual backup (any time)

```bash
cd /path/to/backend
node -e "require('./dist/services/backupService').runBackup().then(console.log)"
```
