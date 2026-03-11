// ENTERPRISE FIX: Phase 6 - Final Polish & Production Handover - 2026-03-05
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const ENTERPRISE_DEFAULT_PASSWORD = 'SecurePassword2026!';
const LEGACY_WEAK_ADMIN_PASSWORDS = new Set(['admin123', 'admin123!', 'admin', 'password', '12345678', 'admin@123']);

const defaultRoles = [
  { name: 'SuperAdmin', description: 'Full access to all system modules', permissions: ['*'], color: '#ef4444' },
  {
    name: 'Admin',
    description: 'Users, reports, backup, and core operations management',
    permissions: [
      'users.*',
      'reports.*',
      'backup.*',
      'items.*',
      'transactions.*',
      'opening-balances.*',
      'theme.*',
      'monitoring.logs.write',
    ],
    color: '#2563eb',
  },
  {
    name: 'Manager',
    description: 'Transactions management with read access to reports and inventories',
    permissions: ['transactions.*', 'reports.view', 'items.view', 'opening-balances.view', 'backup.view'],
    color: '#10b981',
  },
  {
    name: 'Operator',
    description: 'Operational write access for transactions',
    permissions: ['transactions.create', 'transactions.update', 'transactions.delete', 'transactions.view', 'items.view'],
    color: '#f59e0b',
  },
  {
    name: 'Viewer',
    description: 'Read-only access',
    permissions: ['items.view', 'transactions.view', 'reports.view', 'opening-balances.view', 'backup.view'],
    color: '#6b7280',
  },
] as const;

function validatePasswordPolicy(password: string) {
  const candidate = String(password || '');
  const hasMinLength = candidate.length >= 8;
  const hasUpper = /[A-Z]/.test(candidate);
  const hasLower = /[a-z]/.test(candidate);
  const hasDigit = /\d/.test(candidate);
  const hasSpecial = /[^A-Za-z0-9]/.test(candidate);

  return hasMinLength && hasUpper && hasLower && hasDigit && hasSpecial;
}

function resolveDefaultPassword() {
  const rawPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!rawPassword) {
    return ENTERPRISE_DEFAULT_PASSWORD;
  }

  if (LEGACY_WEAK_ADMIN_PASSWORDS.has(rawPassword.toLowerCase()) || !validatePasswordPolicy(rawPassword)) {
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
