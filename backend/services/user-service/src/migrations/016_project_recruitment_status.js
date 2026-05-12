/**
 * Recruitment / team fill for solo projects (max 3 collaborators besides creator).
 * Group-backed projects keep recruitment_status NULL (use group size rules elsewhere).
 */
exports.up = async function (knex) {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE project_recruitment_status AS ENUM (
        'full',
        'looking_for_1',
        'looking_for_2',
        'looking_for_3'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await knex.schema.alterTable('projects', (table) => {
    table.specificType('recruitment_status', 'project_recruitment_status').nullable();
  });

  await knex.raw(`
    UPDATE projects p
    SET recruitment_status = sub.st
    FROM (
      SELECT
        p2.id,
        CASE
          WHEN COALESCE(pm.cnt, 0) >= 3 THEN 'full'::project_recruitment_status
          WHEN COALESCE(pm.cnt, 0) = 2 THEN 'looking_for_1'::project_recruitment_status
          WHEN COALESCE(pm.cnt, 0) = 1 THEN 'looking_for_2'::project_recruitment_status
          ELSE 'looking_for_3'::project_recruitment_status
        END AS st
      FROM projects p2
      LEFT JOIN (
        SELECT project_id, COUNT(*)::int AS cnt
        FROM project_members
        GROUP BY project_id
      ) pm ON pm.project_id = p2.id
      WHERE p2.group_id IS NULL
    ) sub
    WHERE p.id = sub.id
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('recruitment_status');
  });
  await knex.raw('DROP TYPE IF EXISTS project_recruitment_status');
};
