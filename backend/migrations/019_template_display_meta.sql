-- Migration 019: per-template display metadata
--
-- Admin chooses dashboard tile icon, gradient, and description without editing code.
-- Falls back to defaults if NULL.

ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS icon        VARCHAR(8),      -- single emoji, e.g. "✈️"
  ADD COLUMN IF NOT EXISTS gradient    VARCHAR(64),     -- tailwind gradient classes
  ADD COLUMN IF NOT EXISTS description_ja TEXT,
  ADD COLUMN IF NOT EXISTS description_en TEXT;

-- Seed existing templates with the same defaults already in templateLabels.ts
-- so the dashboard tiles look identical post-migration.
UPDATE form_templates SET icon = '💬', gradient = 'from-sky-400 to-blue-500', description_ja = 'ちょっとした質問・相談を投稿', description_en = 'Quick questions or consultations' WHERE code = 'INQUIRY' AND icon IS NULL;
UPDATE form_templates SET icon = '✈️', gradient = 'from-mustard-400 to-mustard-600', description_ja = '出張内容を入力して稟議', description_en = 'Apply for business trip approval' WHERE code = 'BUSINESS_TRIP' AND icon IS NULL;
UPDATE form_templates SET icon = '🏢', gradient = 'from-rose-400 to-pink-500', description_ja = '休日出勤・時間外勤務', description_en = 'Weekend / overtime work' WHERE code = 'OFFICE_OVERTIME' AND icon IS NULL;
UPDATE form_templates SET icon = '🛍️', gradient = 'from-violet-400 to-purple-500', description_ja = '備品・機材の購入申請', description_en = 'Equipment / supplies purchase' WHERE code = 'EQUIPMENT_PURCHASE' AND icon IS NULL;
UPDATE form_templates SET icon = '💻', gradient = 'from-slate-400 to-zinc-500', description_ja = 'PC社外持ち出し', description_en = 'PC takeout' WHERE code = 'PC_TAKEOUT' AND icon IS NULL;
UPDATE form_templates SET icon = '🌴', gradient = 'from-emerald-400 to-teal-500', description_ja = '休暇申請', description_en = 'Leave request' WHERE code = 'LEAVE' AND icon IS NULL;
UPDATE form_templates SET icon = '⏰', gradient = 'from-amber-400 to-orange-500', description_ja = '遅刻・早退届', description_en = 'Tardiness / early leave' WHERE code = 'TARDINESS' AND icon IS NULL;
UPDATE form_templates SET icon = '⚠️', gradient = 'from-red-400 to-rose-500', description_ja = '事故・トラブル報告', description_en = 'Incident report' WHERE code = 'INCIDENT_REPORT' AND icon IS NULL;
UPDATE form_templates SET icon = '💴', gradient = 'from-teal-400 to-cyan-500', description_ja = '立替経費精算', description_en = 'Expense claim' WHERE code = 'EXPENSE_CLAIM' AND icon IS NULL;

-- Default for any other / future templates
UPDATE form_templates SET icon = '📋', gradient = 'from-slate-400 to-slate-500' WHERE icon IS NULL;
