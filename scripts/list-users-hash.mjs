import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const users = await prisma.user.findMany({
    select: {
      username: true,
      email: true,
      isActive: true,
      passwordHash: true
    }
  });
  console.log(JSON.stringify(users, null, 2));
} catch (e) {
  console.error('Error:', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
