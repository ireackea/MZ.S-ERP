const { PrismaPg } = require('@prisma/adapter-pg');

module.exports = {
  url: 'file:./prisma/dev.db',
  adapter: new PrismaPg({ connectionString: 'file:./prisma/dev.db' }),
};
