/**
 * Knex seed — same roster as startup dev sync.
 *
 *   npm run seed:dev
 */
const { syncDevAccounts } = require('../lib/syncDevAccounts');

exports.seed = async function seedDevAccounts(knex) {
  const r = await syncDevAccounts(knex);
  if (r.skipped) {
    console.log('[seed dev_accounts] skipped (production)');
    return;
  }
  console.log(`[seed dev_accounts] synced ${r.count} dev users; password=${r.password}`);
};
