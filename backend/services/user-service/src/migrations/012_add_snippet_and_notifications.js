/**
 * Migration 012:
 * 1) Re-add snippet support on project_requests
 * 2) Add notifications table for in-app history/read state
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE project_requests
    ADD COLUMN IF NOT EXISTS snippet TEXT;
  `);

  await knex.schema.createTable('notifications', (table) => {
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.string('type', 100).notNullable();
    table.string('title', 255).notNullable();
    table.text('message').notNullable();
    table.jsonb('metadata').notNullable().defaultTo('{}');
    table.boolean('is_read').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('notifications');
  await knex.raw(`
    ALTER TABLE project_requests
    DROP COLUMN IF EXISTS snippet;
  `);
};
