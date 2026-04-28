require('dotenv/config');

const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: 'backend/prisma/schema.prisma',
  migrations: {
    path: 'backend/prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
