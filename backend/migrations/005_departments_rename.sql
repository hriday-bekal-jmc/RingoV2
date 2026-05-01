-- Rename departments to match actual company structure
-- 総務部 handles financial confirmation (no separate accounting dept)

UPDATE departments SET name = 'DX事業推進室',  code = 'DX'    WHERE code = 'DX';
UPDATE departments SET name = 'JMC',            code = 'JMC'   WHERE code = 'SALES';
UPDATE departments SET name = '企画推進室',     code = 'KIKAKU' WHERE code = 'KEIRI';
UPDATE departments SET name = '保健情報部',     code = 'HOKEN'  WHERE code = 'KENPO';
UPDATE departments SET name = '総務部',         code = 'SOUMU'  WHERE code = 'SOUMU';
UPDATE departments SET name = '美容決済部',     code = 'BIYOU'  WHERE code = 'BIYOU';
