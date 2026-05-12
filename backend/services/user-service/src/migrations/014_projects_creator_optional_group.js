/**
 * Optional group on projects: solo projects use creator_student_id only.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('projects', (table) => {
    table
      .uuid('creator_student_id')
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
  });

  await knex.raw(`
    UPDATE projects p
    SET creator_student_id = g.leader_id
    FROM groups g
    WHERE p.group_id = g.id
  `);

  const orphan = await knex('projects').whereNull('creator_student_id').first();
  if (orphan) {
    throw new Error(
      'Migration 014: projects exist without a matching group row; fix data before migrating.'
    );
  }

  await knex.raw('ALTER TABLE projects ALTER COLUMN creator_student_id SET NOT NULL');
  await knex.raw('ALTER TABLE projects ALTER COLUMN group_id DROP NOT NULL');
};

exports.down = async function (knex) {
  await knex('projects').whereNull('group_id').delete();
  await knex.raw('ALTER TABLE projects ALTER COLUMN group_id SET NOT NULL');
  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('creator_student_id');
  });
};
