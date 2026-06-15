import argon2 from 'argon2';
import { pool } from '../src/config/db';

const BUSINESS_TRIP_RINGI_SCHEMA = {
  fields: [
    { name: 'destination',          label: '出張先',           type: 'text',     required: true  },
    { name: 'start_date',           label: '開始日',           type: 'date',     required: true  },
    { name: 'end_date',             label: '終了日',           type: 'date',     required: true  },
    { name: 'purpose',              label: '出張目的',         type: 'textarea', required: true  },
    { name: 'expected_amount',      label: '予定金額 (円)',    type: 'number',   required: true  },
    { name: 'transportation_method',label: '交通手段',         type: 'text',     required: false },
  ],
};

const BUSINESS_TRIP_SETTLEMENT_SCHEMA = {
  fields: [
    { name: 'actual_amount',      label: '実際合計金額 (円)',     type: 'number',   required: true,  multiple: false },
    { name: 'transportation_fee', label: '交通費 (円)',            type: 'number',   required: false, multiple: false },
    { name: 'accommodation_fee', label: '宿泊費 (円)',             type: 'number',   required: false, multiple: false },
    { name: 'food_fee',           label: '食事代 (円)',            type: 'number',   required: false, multiple: false },
    { name: 'other_fee',          label: 'その他 (円)',            type: 'number',   required: false, multiple: false },
    { name: 'receipt_files',      label: '領収書 (PDF/画像)',      type: 'file',     required: true,  multiple: true  },
    { name: 'notes',              label: '備考',                   type: 'textarea', required: false, multiple: false },
  ],
};

interface UserSeed {
  email: string;
  name: string;
  role: string;
  is_admin?: boolean;
  dept: string;
  pw: boolean;
}

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // workflow_patterns
    await client.query(`
      INSERT INTO workflow_patterns (code, name, description) VALUES
        ('PATTERN_1', 'Approval Only',          '稟議のみ。承認完了で完結'),
        ('PATTERN_2', 'Settlement Only',         '精算のみ'),
        ('PATTERN_3', 'Approval + Settlement',   '稟議承認後に精算')
      ON CONFLICT (code) DO NOTHING
    `);

    // departments
    const deptRows = await client.query(`
      INSERT INTO departments (name, code) VALUES
        ('JMC',            'JMC'),
        ('DX事業推進室',    'DX'),
        ('企画推進室',     'KIKAKU'),
        ('保健情報部',     'HOKEN'),
        ('総務部',         'SOUMU'),
        ('美容決済部',     'BIYOU')
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, code
    `);
    const deptByCode: Record<string, string> = Object.fromEntries(
      deptRows.rows.map((r: { code: string; id: string }) => [r.code, r.id]),
    );

    // users
    const DEV_PASSWORD_HASH = await argon2.hash('Ringo2026!');
    const usersData: UserSeed[] = [
      { email: 'taro.tanaka@jmc-ltd.co.jp', name: '田中 太郎', role: 'EMPLOYEE',   dept: 'DX',    pw: false },
      { email: 'manager1@jmc-ltd.co.jp',    name: '山田 一郎', role: 'MANAGER',    dept: 'DX',    pw: false },
      { email: 'gm1@jmc-ltd.co.jp',         name: '鈴木 花子', role: 'GM',         dept: 'DX',    pw: false },
      { email: 'soumu1@jmc-ltd.co.jp',      name: '佐藤 三郎', role: 'SOUMU',      dept: 'SOUMU', pw: false },
      { email: 'senmu@jmc-ltd.co.jp',       name: '高橋 専務', role: 'SENMU',      dept: 'SOUMU', pw: false },
      { email: 'shacho@jmc-ltd.co.jp',      name: '渡辺 社長', role: 'PRESIDENT',  dept: 'SOUMU', pw: false },
      { email: 'keiri1@jmc-ltd.co.jp',      name: '中村 経理', role: 'SOUMU',      dept: 'KIKAKU', pw: false },
      // ── Admin ── login: h-bekal@jmc-ltd.co.jp / Ringo2026!
      { email: 'h-bekal@jmc-ltd.co.jp',    name: 'H. Bekal',  role: 'SOUMU',      dept: 'SOUMU', is_admin: true, pw: true  },
    ];

    const userIdByEmail: Record<string, string> = {};
    for (const u of usersData) {
      const r = await client.query(
        `INSERT INTO users (full_name, email, role, is_admin, department_id, password_hash, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (email) DO UPDATE SET
           full_name     = EXCLUDED.full_name,
           role          = EXCLUDED.role,
           is_admin      = EXCLUDED.is_admin,
           department_id = EXCLUDED.department_id,
           password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash)
         RETURNING id`,
        [u.name, u.email, u.role, u.is_admin ?? false, deptByCode[u.dept], u.pw ? DEV_PASSWORD_HASH : null],
      );
      userIdByEmail[u.email] = r.rows[0].id as string;
    }

    // form_templates
    const patternId3 = (
      await client.query(`SELECT id FROM workflow_patterns WHERE code = 'PATTERN_3'`)
    ).rows[0].id as string;

    // 002_seed_business_trip.sql owns the canonical BUSINESS_TRIP schema — don't overwrite it.
    // Insert only if missing; on conflict just fetch existing id.
    await client.query(
      `INSERT INTO form_templates (pattern_id, code, title, title_ja, schema_definition, settlement_schema, is_active)
       VALUES ($1, 'BUSINESS_TRIP', 'Business Trip', '出張伺い', $2::jsonb, $3::jsonb, TRUE)
       ON CONFLICT (code) DO NOTHING`,
      [patternId3, JSON.stringify(BUSINESS_TRIP_RINGI_SCHEMA), JSON.stringify(BUSINESS_TRIP_SETTLEMENT_SCHEMA)],
    );
    const templateRow = await client.query(
      `SELECT id FROM form_templates WHERE code = 'BUSINESS_TRIP'`,
    );
    const templateId = templateRow.rows[0].id as string;

    // template_permissions
    for (const code of ['DX', 'SOUMU', 'HOKEN', 'BIYOU', 'KIKAKU', 'JMC']) {
      await client.query(
        `INSERT INTO template_permissions (template_id, department_id, requirement_level)
         VALUES ($1, $2, 'SHOULD')
         ON CONFLICT DO NOTHING`,
        [templateId, deptByCode[code]],
      );
    }

    // RINGI route — DX dept: Manager → GM
    const ringiRoute = await client.query(
      `INSERT INTO approval_routes (template_id, department_id, name, stage, is_default, is_active)
       VALUES ($1, $2, 'BUSINESS_TRIP / DX / RINGI', 'RINGI', TRUE, TRUE)
       ON CONFLICT (template_id, department_id, stage, name) DO UPDATE SET is_active = TRUE
       RETURNING id`,
      [templateId, deptByCode['DX']],
    );
    const ringiRouteId = ringiRoute.rows[0].id as string;
    await client.query(`DELETE FROM approval_route_steps WHERE route_id = $1`, [ringiRouteId]);
    await client.query(
      `INSERT INTO approval_route_steps (route_id, step_order, approver_id, label, action_type) VALUES
        ($1, 1, $2, '承認者1 (Manager)', 'APPROVE'),
        ($1, 2, $3, '承認者2 (GM)',      'APPROVE')`,
      [ringiRouteId, userIdByEmail['manager1@jmc-ltd.co.jp'], userIdByEmail['gm1@jmc-ltd.co.jp']],
    );

    // SETTLEMENT route — DX dept: 5 steps
    const settlementRoute = await client.query(
      `INSERT INTO approval_routes (template_id, department_id, name, stage, is_default, is_active)
       VALUES ($1, $2, 'BUSINESS_TRIP / DX / SETTLEMENT', 'SETTLEMENT', TRUE, TRUE)
       ON CONFLICT (template_id, department_id, stage, name) DO UPDATE SET is_active = TRUE
       RETURNING id`,
      [templateId, deptByCode['DX']],
    );
    const settlementRouteId = settlementRoute.rows[0].id as string;
    await client.query(`DELETE FROM approval_route_steps WHERE route_id = $1`, [settlementRouteId]);
    await client.query(
      `INSERT INTO approval_route_steps (route_id, step_order, approver_id, label, action_type) VALUES
        ($1, 1, $2, '承認者1 (Manager)',         'APPROVE'),
        ($1, 2, $3, '承認者2 / 部門承認 (GM)',   'APPROVE'),
        ($1, 3, $4, '総務承認',                  'APPROVE'),
        ($1, 4, $5, '専務 → 社長 (確認)',        'CONFIRM'),
        ($1, 5, $6, '経理精算処理',              'APPROVE')`,
      [
        settlementRouteId,
        userIdByEmail['manager1@jmc-ltd.co.jp'],
        userIdByEmail['gm1@jmc-ltd.co.jp'],
        userIdByEmail['soumu1@jmc-ltd.co.jp'],
        userIdByEmail['shacho@jmc-ltd.co.jp'],
        userIdByEmail['keiri1@jmc-ltd.co.jp'],
      ],
    );

    await client.query('COMMIT');
    console.log('[seed] ✅ done');
    console.log('  - departments:', Object.keys(deptByCode).join(', '));
    console.log('  - users:', usersData.length);
    console.log('  - template: BUSINESS_TRIP (出張伺い)');
    console.log('  - routes: RINGI (2 steps), SETTLEMENT (5 steps)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
