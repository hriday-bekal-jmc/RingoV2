/**
 * Usage: node scripts/set-password.js <email> <password>
 * Sets (or resets) a user's password in the DB using argon2 hashing.
 * Run this to bootstrap the first admin login.
 *
 * Example:
 *   node scripts/set-password.js admin@jmc-ltd.co.jp MySecret123!
 */
import argon2 from 'argon2';
import { pool } from '../src/config/db.js';
import dotenv from 'dotenv';
dotenv.config();

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error('Usage: node scripts/set-password.js <email> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters');
  process.exit(1);
}

const client = await pool.connect();
try {
  const userRes = await client.query('SELECT id, full_name, role FROM users WHERE email = $1', [email]);
  if (userRes.rows.length === 0) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }
  const user = userRes.rows[0];
  const hash = await argon2.hash(password);
  await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
  console.log(`✅ Password set for: ${user.full_name} (${email}) — role: ${user.role}`);
} finally {
  client.release();
  await pool.end();
}
