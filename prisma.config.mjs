const { PrismaPg } = require('@prisma/adapter-pg');

const config = {
  url: 'file:./backend/prisma/dev.db',
  adapter: new PrismaPg({ connectionString: 'file:./backend/prisma/dev.db' }),
};

export default config;
