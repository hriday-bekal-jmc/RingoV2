-- 057: Settlement amount adjustment by accounting (soumu)
--
-- Lets a user with settle permission correct the final settlement total on the
-- accounting page (e.g. receipt re-calc found a small diff) WITHOUT returning the
-- whole application. The original applicant submission (settlement_data) is never
-- mutated — we store an override + audit fields so the original stays immutable.
--
-- Display logic everywhere prefers: COALESCE(adjusted_amount, recompute(settlement_data)).

-- ── 1. Override columns on settlements ────────────────────────────────────────
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS adjusted_amount   NUMERIC(12, 2),          -- null = no adjustment
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS adjusted_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adjusted_at       TIMESTAMPTZ;

-- Guard: a non-negative adjusted amount when present.
ALTER TABLE settlements
  DROP CONSTRAINT IF EXISTS chk_adjusted_amount_nonneg;
ALTER TABLE settlements
  ADD CONSTRAINT chk_adjusted_amount_nonneg CHECK (
    adjusted_amount IS NULL OR adjusted_amount >= 0
  );

-- ── 2. Notification template — SETTLEMENT_AMOUNT_ADJUSTED ──────────────────────
-- Sent to the applicant when accounting adjusts the final amount (notify opt-in).
-- Vars: applicant_name, template_name, application_number, old_amount, new_amount,
--       adjustment_reason, actor_name, date, app_url
INSERT INTO notification_templates (event_type, subject, body_html) VALUES
(
  'SETTLEMENT_AMOUNT_ADJUSTED',
  '【RINGO】{{template_name}} の精算金額が調整されました',
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
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#2d2d2d;">💴 精算金額が調整されました</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b6b6b;">経理担当者により精算金額が調整されました。詳細は下記をご確認ください。</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#edf6fb;border-radius:8px;padding:16px;margin-bottom:16px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;">申請者</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{applicant_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請種別</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{template_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">申請番号</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{application_number}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">調整前金額</td><td style="padding:4px 0;font-size:13px;color:#9e9589;text-decoration:line-through;">¥{{old_amount}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">調整後金額</td><td style="padding:4px 0;font-size:15px;color:#1a5c7a;font-weight:700;">¥{{new_amount}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">担当者</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{actor_name}}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#edf6fb;border:1px solid #a8d8f0;border-radius:8px;padding:14px;margin-bottom:24px;">
      <tr><td style="font-size:12px;color:#1a5c7a;font-weight:600;padding-bottom:6px;">調整理由</td></tr>
      <tr><td style="font-size:13px;color:#143d52;">{{adjustment_reason}}</td></tr>
    </table>
    <a href="{{app_url}}" style="display:inline-block;background:#1a5c7a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">申請を確認する →</a>
  </td></tr>
  <tr><td style="background:#f7f3ef;padding:16px 32px;border-top:1px solid #ede8e3;">
    <p style="margin:0;color:#b0a89e;font-size:11px;">このメールはRINGOシステムから自動送信されています。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>$HTML$
)
ON CONFLICT (event_type) DO NOTHING;
