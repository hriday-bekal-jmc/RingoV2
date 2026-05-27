-- 048: add route progress row to existing notification templates
-- Inserts {{route_dots}} + {{route_progress}} before the 日付 row in all seeded templates.
-- Safe to run multiple times — replace() is idempotent if already done.

UPDATE notification_templates
SET body_html = replace(
  body_html,
  '<tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>',
  '<tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">承認進捗</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-family:monospace,''Courier New'',Courier;letter-spacing:2px;">{{route_dots}}&nbsp;&nbsp;<span style="font-family:''Helvetica Neue'',Arial,sans-serif;letter-spacing:normal;color:#6b6b6b;font-size:12px;">{{route_progress}}</span></td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;">日付</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{date}}</td></tr>'
),
updated_at = NOW()
WHERE event_type IN (
  'APP_SUBMITTED',
  'STEP_ACTION_REQUIRED',
  'APP_APPROVED',
  'APP_RETURNED',
  'APP_REJECTED',
  'SETTLEMENT_SUBMITTED',
  'SETTLEMENT_APPROVED'
)
AND body_html NOT LIKE '%route_dots%';
