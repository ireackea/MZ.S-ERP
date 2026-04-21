import { PrismaPg } from '@prisma/adapter-pg';

export default {
  url: 'file:./prisma/dev.db',
  adapter: new PrismaPg({ connectionString: 'file:./prisma/dev.db' }),
};
