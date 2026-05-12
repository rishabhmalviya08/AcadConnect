/**
 * Set EVERY user's password to the same value (local/dev recovery only).
 *
 * Requires explicit opt-in (prevents accidental production use):
 *   ALLOW_RESET_ALL_PASSWORDS=1 npm run emergency:reset-passwords
 *
 * Optional:
 *   RESET_PASSWORD_TO — default 12345678
 *   NORMALIZE_USER_EMAILS=1 — UPDATE users SET email = LOWER(TRIM(email)) (fixes casing drift)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const knex = require('knex');
const bcrypt = require('bcryptjs');

const knexfile = require('../knexfile');
const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const db = knex(knexfile[env]);

async function main() {
  if (process.env.ALLOW_RESET_ALL_PASSWORDS !== '1') {
    console.error(
      'Refusing to run: set ALLOW_RESET_ALL_PASSWORDS=1 if you really want to reset every user password.'
    );
    process.exit(1);
  }

  const plain = process.env.RESET_PASSWORD_TO || '12345678';
  if (plain.length < 8) {
    console.error('RESET_PASSWORD_TO must be at least 8 characters');
    process.exit(1);
  }

  if (process.env.NORMALIZE_USER_EMAILS === '1') {
    await db.raw('UPDATE users SET email = LOWER(TRIM(email))');
    console.log('Normalized all user emails to LOWER(TRIM(email)).');
  }

  const [{ count }] = await db('users').count('id as count');
  const n = Number(count);
  const password_hash = await bcrypt.hash(plain, 12);
  await db('users').update({ password_hash });
  console.log(`Updated password_hash for ${n} user(s). Use the password you set in RESET_PASSWORD_TO (default 12345678).`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
