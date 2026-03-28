import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      roleId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' }
  });
  console.log(JSON.stringify(users, null, 2));
} catch (e) {
  console.error('Error querying users:', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
