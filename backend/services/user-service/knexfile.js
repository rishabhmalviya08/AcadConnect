const envFile = process.env.NODE_ENV === 'test' ? '../../.env.test' : '../../.env';
require('dotenv').config({ path: envFile });

/**
 * Knex configuration file.
 * Run migrations with: npx knex migrate:latest
 */
module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT) || 5432,
      user: process.env.POSTGRES_USER || 'acadconnect',
      password: process.env.POSTGRES_PASSWORD || 'yourStrongPassword',
      database: process.env.POSTGRES_DB || 'acadconnect',
      ssl: process.env.POSTGRES_HOST && process.env.POSTGRES_HOST !== 'localhost' ? { rejectUnauthorized: false } : false,
    },
    migrations: {
      directory: './src/migrations',
      tableName: 'knex_migrations',
    },
    pool: { min: 2, max: 10 },
  },

  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: './src/migrations',
      tableName: 'knex_migrations',
    },
    pool: { min: 2, max: 10 },
  },

  test: {
    client: 'pg',
    connection: process.env.TEST_DATABASE_URL,
    migrations: {
      directory: './src/migrations',
      tableName: 'knex_migrations',
    },
    pool: { min: 1, max: 5 },
  },
};
