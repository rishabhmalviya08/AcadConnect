/**
 * Project-driven collaboration:
 * - project_join_requests: students ask to join a project; creator is notified.
 * - project_members: accepted collaborators on solo (no group) projects.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('project_join_requests', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('project_id')
      .notNullable()
      .references('id')
      .inTable('projects')
      .onDelete('CASCADE');
    table
      .uuid('requester_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.string('status', 20).notNullable().defaultTo('pending'); // pending | accepted | rejected
    table.text('message');
    table.timestamps(true, true);
    table.unique(['project_id', 'requester_id']);
  });

  await knex.schema.createTable('project_members', (table) => {
    table
      .uuid('project_id')
      .notNullable()
      .references('id')
      .inTable('projects')
      .onDelete('CASCADE');
    table
      .uuid('student_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.timestamps(true, true);
    table.primary(['project_id', 'student_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('project_members');
  await knex.schema.dropTableIfExists('project_join_requests');
};
