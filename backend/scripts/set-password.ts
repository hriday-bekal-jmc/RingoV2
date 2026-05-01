/**
 * Usage: npm run set-password <email> <password>
 * Sets (or resets) a user's password using argon2 hashing.
 * Run this to bootstrap the first admin login.
 *
 * Example:
 *   npm run set-password h-bekal@jmc-ltd.co.jp MySecret123!
 */
import argon2 from 'argon2';
import dotenv from 'dotenv';
import { pool } from '../src/config/db';

dotenv.config();

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error('Usage: npm run set-password <email> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters');
  process.exit(1);
}

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    const userRes = await client.query(
      'SELECT id, full_name, role FROM users WHERE email = $1',
      [email.toLowerCase().trim()],
    );
    if (userRes.rows.length === 0) {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }
    const user = userRes.rows[0] as { id: string; full_name: string; role: string };
    const hash = await argon2.hash(password);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    console.log(`✅ Password set for: ${user.full_name} (${email}) — role: ${user.role}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
