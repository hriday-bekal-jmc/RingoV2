-- 047: notification_templates + user notification preferences

-- ── 1. User notification columns ─────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notify_email      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_gchat      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gchat_webhook_url TEXT;

-- Validate webhook URLs are either null or start with the Google Chat prefix
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS chk_gchat_webhook_url;
ALTER TABLE users
  ADD CONSTRAINT chk_gchat_webhook_url CHECK (
    gchat_webhook_url IS NULL
    OR gchat_webhook_url LIKE 'https://chat.googleapis.com/%'
  );

-- ── 2. Notification templates table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_templates (
  event_type  TEXT        PRIMARY KEY,
  subject     TEXT        NOT NULL DEFAULT '',
  body_html   TEXT        NOT NULL DEFAULT '',
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Seed default templates ─────────────────────────────────────────────────
-- Uses ON CONFLICT DO NOTHING so re-running is safe and admin edits are preserved.

INSERT INTO notification_templates (event_type, subject, body_html) VALUES
(
  'APP_SUBMITTED',
  '【RINGO】{{template_name}} の申請を受け付けました',
  $HTML$<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f7f3ef;font-family:''Helvetica Neue'',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f3ef;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
  <tr><td style="background:#b83227;padding:24px 32px;">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🍎 RINGO</p>
    <p style="margin:4px 0 0;color:#f5c5bc;font-size:12px;">稟議・精算管理システム</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#2d2d2d;">申請を受け付けました</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b6b6b;">以下の申請が提出され、承認待ちになりました。</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ef;border-radius:8px;padding:16px;margin-bottom:24px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;">申請者</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{applicant_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請種別</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{template_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">部署</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{department_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請番号</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{application_number}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>
    </table>
    <a href="{{app_url}}" style="display:inline-block;background:#b83227;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">申請を確認する →</a>
  </td></tr>
  <tr><td style="background:#f7f3ef;padding:16px 32px;border-top:1px solid #ede8e3;">
    <p style="margin:0;color:#b0a89e;font-size:11px;">このメールはRINGOシステムから自動送信されています。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>$HTML$
),
(
  'STEP_ACTION_REQUIRED',
  '【RINGO】承認依頼 — {{template_name}}',
  $HTML$<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f7f3ef;font-family:''Helvetica Neue'',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f3ef;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
  <tr><td style="background:#b83227;padding:24px 32px;">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🍎 RINGO</p>
    <p style="margin:4px 0 0;color:#f5c5bc;font-size:12px;">稟議・精算管理システム</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#2d2d2d;">🔔 承認が必要です</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b6b6b;">以下の申請があなたの承認を待っています。</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ef;border-radius:8px;padding:16px;margin-bottom:24px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;">申請者</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{applicant_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請種別</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{template_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">部署</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{department_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請番号</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{application_number}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">ステップ</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{step_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>
    </table>
    <a href="{{app_url}}" style="display:inline-block;background:#b83227;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">承認画面を開く →</a>
  </td></tr>
  <tr><td style="background:#f7f3ef;padding:16px 32px;border-top:1px solid #ede8e3;">
    <p style="margin:0;color:#b0a89e;font-size:11px;">このメールはRINGOシステムから自動送信されています。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>$HTML$
),
(
  'APP_APPROVED',
  '【RINGO】{{template_name}} が承認されました',
  $HTML$<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f7f3ef;font-family:''Helvetica Neue'',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f3ef;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
  <tr><td style="background:#1a7a4a;padding:24px 32px;">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🍎 RINGO</p>
    <p style="margin:4px 0 0;color:#a8e6c3;font-size:12px;">稟議・精算管理システム</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#2d2d2d;">✅ 申請が承認されました</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b6b6b;">おめでとうございます。申請が最終承認されました。</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f4;border-radius:8px;padding:16px;margin-bottom:24px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;">申請者</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{applicant_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請種別</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{template_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請番号</td><td style="padding:4px 0;font-size:13px;color:#1a7a4a;font-weight:700;">{{application_number}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">承認者</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{actor_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>
    </table>
    <a href="{{app_url}}" style="display:inline-block;background:#1a7a4a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">申請を確認する →</a>
  </td></tr>
  <tr><td style="background:#f7f3ef;padding:16px 32px;border-top:1px solid #ede8e3;">
    <p style="margin:0;color:#b0a89e;font-size:11px;">このメールはRINGOシステムから自動送信されています。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>$HTML$
),
(
  'APP_RETURNED',
  '【RINGO】{{template_name}} が差し戻されました',
  $HTML$<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f7f3ef;font-family:''Helvetica Neue'',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f3ef;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
  <tr><td style="background:#c47200;padding:24px 32px;">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🍎 RINGO</p>
    <p style="margin:4px 0 0;color:#ffe0a3;font-size:12px;">稟議・精算管理システム</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#2d2d2d;">↩ 申請が差し戻されました</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b6b6b;">内容を修正して再申請してください。</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf5e8;border-radius:8px;padding:16px;margin-bottom:16px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;">申請種別</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{template_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請番号</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{application_number}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">差し戻した人</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{actor_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8ec;border:1px solid #f0d080;border-radius:8px;padding:14px;margin-bottom:24px;">
      <tr><td style="font-size:12px;color:#7a5a00;font-weight:600;padding-bottom:6px;">コメント</td></tr>
      <tr><td style="font-size:13px;color:#4a3500;">{{comment}}</td></tr>
    </table>
    <a href="{{app_url}}" style="display:inline-block;background:#c47200;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">修正して再申請する →</a>
  </td></tr>
  <tr><td style="background:#f7f3ef;padding:16px 32px;border-top:1px solid #ede8e3;">
    <p style="margin:0;color:#b0a89e;font-size:11px;">このメールはRINGOシステムから自動送信されています。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>$HTML$
),
(
  'APP_REJECTED',
  '【RINGO】{{template_name}} が却下されました',
  $HTML$<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f7f3ef;font-family:''Helvetica Neue'',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f3ef;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
  <tr><td style="background:#7a1a1a;padding:24px 32px;">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🍎 RINGO</p>
    <p style="margin:4px 0 0;color:#f5c5c5;font-size:12px;">稟議・精算管理システム</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#2d2d2d;">✗ 申請が却下されました</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b6b6b;">申請が却下されました。詳細は下記をご確認ください。</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf0f0;border-radius:8px;padding:16px;margin-bottom:16px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;">申請種別</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{template_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請番号</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{application_number}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">却下した人</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{actor_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff0f0;border:1px solid #e8c0c0;border-radius:8px;padding:14px;margin-bottom:24px;">
      <tr><td style="font-size:12px;color:#7a1a1a;font-weight:600;padding-bottom:6px;">コメント</td></tr>
      <tr><td style="font-size:13px;color:#4a0000;">{{comment}}</td></tr>
    </table>
    <a href="{{app_url}}" style="display:inline-block;background:#7a1a1a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">申請を確認する →</a>
  </td></tr>
  <tr><td style="background:#f7f3ef;padding:16px 32px;border-top:1px solid #ede8e3;">
    <p style="margin:0;color:#b0a89e;font-size:11px;">このメールはRINGOシステムから自動送信されています。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>$HTML$
),
(
  'SETTLEMENT_SUBMITTED',
  '【RINGO】{{template_name}} の精算申請を受け付けました',
  $HTML$<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f7f3ef;font-family:''Helvetica Neue'',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f3ef;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
  <tr><td style="background:#1a5c7a;padding:24px 32px;">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🍎 RINGO</p>
    <p style="margin:4px 0 0;color:#a8d8f0;font-size:12px;">稟議・精算管理システム</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#2d2d2d;">💴 精算申請を受け付けました</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b6b6b;">精算申請が提出され、承認待ちになりました。</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#edf6fb;border-radius:8px;padding:16px;margin-bottom:24px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;">申請者</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{applicant_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請種別</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{template_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請番号</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{application_number}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>
    </table>
    <a href="{{app_url}}" style="display:inline-block;background:#1a5c7a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">精算申請を確認する →</a>
  </td></tr>
  <tr><td style="background:#f7f3ef;padding:16px 32px;border-top:1px solid #ede8e3;">
    <p style="margin:0;color:#b0a89e;font-size:11px;">このメールはRINGOシステムから自動送信されています。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>$HTML$
),
(
  'SETTLEMENT_APPROVED',
  '【RINGO】{{template_name}} の精算が承認されました',
  $HTML$<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f7f3ef;font-family:''Helvetica Neue'',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f3ef;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
  <tr><td style="background:#1a7a4a;padding:24px 32px;">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🍎 RINGO</p>
    <p style="margin:4px 0 0;color:#a8e6c3;font-size:12px;">稟議・精算管理システム</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#2d2d2d;">✅ 精算が承認されました</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b6b6b;">精算申請が承認されました。振込手続きが開始されます。</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f4;border-radius:8px;padding:16px;margin-bottom:24px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;">申請者</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{applicant_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請種別</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{template_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請番号</td><td style="padding:4px 0;font-size:13px;color:#1a7a4a;font-weight:700;">{{application_number}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">承認者</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{actor_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>
    </table>
    <a href="{{app_url}}" style="display:inline-block;background:#1a7a4a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">申請を確認する →</a>
  </td></tr>
  <tr><td style="background:#f7f3ef;padding:16px 32px;border-top:1px solid #ede8e3;">
    <p style="margin:0;color:#b0a89e;font-size:11px;">このメールはRINGOシステムから自動送信されています。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>$HTML$
)
ON CONFLICT (event_type) DO NOTHING;
