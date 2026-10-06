// ENTERPRISE FIX: Phase 6 - Final Polish & Production Handover - 2026-03-05
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { isPasswordPolicyCompliant, isWeakLegacyPassword } from '../src/common/password-policy';
import { DEFAULT_ROLES } from '../src/auth/role-templates';

// Prisma 7 requires a driver adapter, exactly like the running app does in
// prisma.service.ts. Calling the no-argument constructor here is why the seed used to
// exit with PrismaClientInitializationError before writing a single row.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: String(process.env.DATABASE_URL || '').trim() }),
});
const ENTERPRISE_DEFAULT_PASSWORD = 'SecurePassword2026!';

// FC-SEC-006 — this file used to carry its own `defaultRoles` list, and it was
// narrower than `role-templates.ts`: Manager/Operator/Viewer were seeded without
// `dashboard.view`, `inventory.*` or `partners.view`. Because the app only
// creates a role when it is missing, the seed's list won on every install and
// the template could never take effect. There is now one definition.
const defaultRoles = DEFAULT_ROLES.map((role) => ({
  name: role.name,
  description: role.description,
  permissions: [...role.permissions],
  color: role.color,
}));

function validatePasswordPolicy(password: string) {
  return isPasswordPolicyCompliant(password);
}

function resolveDefaultPassword() {
  const rawPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!rawPassword) {
    return ENTERPRISE_DEFAULT_PASSWORD;
  }

  if (isWeakLegacyPassword(rawPassword) || !validatePasswordPolicy(rawPassword)) {
    console.warn('[Seed] Ignoring weak ADMIN_PASSWORD value and enforcing enterprise default password.');
    return ENTERPRISE_DEFAULT_PASSWORD;
  }

  return rawPassword;
}

async function main() {
  for (const role of defaultRoles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {
        description: role.description,
        permissions: JSON.stringify(role.permissions),
        color: role.color,
      },
      create: {
        name: role.name,
        description: role.description,
        permissions: JSON.stringify(role.permissions),
        color: role.color,
      },
    });
  }

  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SuperAdmin' } });
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Manager' } });
  const viewerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Viewer' } });
  const defaultPassword = resolveDefaultPassword();
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  await prisma.user.upsert({
    where: { username: 'superadmin' },
    update: {
      email: 'superadmin@feedfactory.local',
      passwordHash,
      firstName: 'System',
      lastName: 'SuperAdmin',
      isActive: true,
      roleId: superAdminRole.id,
      theme: 'classic',
    },
    create: {
      username: 'superadmin',
      email: 'superadmin@feedfactory.local',
      passwordHash,
      firstName: 'System',
      lastName: 'SuperAdmin',
      isActive: true,
      roleId: superAdminRole.id,
      theme: 'classic',
    },
  });

  await prisma.user.upsert({
    where: { username: 'manager' },
    update: {
      email: 'manager@feedfactory.local',
      passwordHash,
      firstName: 'Ops',
      lastName: 'Manager',
      isActive: true,
      roleId: managerRole.id,
      theme: 'classic',
    },
    create: {
      username: 'manager',
      email: 'manager@feedfactory.local',
      passwordHash,
      firstName: 'Ops',
      lastName: 'Manager',
      isActive: true,
      roleId: managerRole.id,
      theme: 'classic',
    },
  });

  await prisma.user.upsert({
    where: { username: 'viewer' },
    update: {
      email: 'viewer@feedfactory.local',
      passwordHash,
      firstName: 'Read',
      lastName: 'Only',
      isActive: true,
      roleId: viewerRole.id,
      theme: 'classic',
    },
    create: {
      username: 'viewer',
      email: 'viewer@feedfactory.local',
      passwordHash,
      firstName: 'Read',
      lastName: 'Only',
      isActive: true,
      roleId: viewerRole.id,
      theme: 'classic',
    },
  });

  console.log(`Seeded default RBAC roles and users (superadmin, manager, viewer) with password: ${defaultPassword}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
