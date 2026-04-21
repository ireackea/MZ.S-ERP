import { PrismaPg } from '@prisma/adapter-pg';

const config = {
  url: process.env.DATABASE_URL,
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
};

export default config;
