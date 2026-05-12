/**
 * Add optional project abstract (distinct from full description).
 */
exports.up = function (knex) {
  return knex.schema.alterTable('projects', (table) => {
    table.text('abstract').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('projects', (table) => {
    table.dropColumn('abstract');
  });
};
