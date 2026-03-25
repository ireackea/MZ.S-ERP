// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
/**
 * Unified Users Seeder
 *
 * Seeds the canonical user set used by backend bootstrap and frontend login flows.
 * Keeps role creation and password hashing aligned across environments.
 */

import { PrismaClient } from '@prisma/client';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Canonical seeded users used for local development and smoke validation.
const UNIFIED_USERS = [
  {
    username: 'admin',
    email: 'admin@feedfactory.local',
    password: 'Admin@123!',
    firstName: 'System',
    lastName: 'Administrator',
    roleName: 'SuperAdmin',
    isActive: true,
  },
  {
    username: 'superadmin',
    email: 'superadmin@feedfactory.local',
    password: 'Admin@123!',
    firstName: 'Primary',
    lastName: 'SuperAdmin',
    roleName: 'SuperAdmin',
    isActive: true,
  },
  {
    username: 'manager',
    email: 'manager@feedfactory.local',
    password: 'Manager@123!',
    firstName: 'Operations',
    lastName: 'Manager',
    roleName: 'Manager',
    isActive: true,
  },
  {
    username: 'storekeeper',
    email: 'storekeeper@feedfactory.local',
    password: 'Store@123!',
    firstName: 'Main',
    lastName: 'Storekeeper',
    roleName: 'Storekeeper',
    isActive: true,
  },
  {
    username: 'viewer',
    email: 'viewer@feedfactory.local',
    password: 'Viewer@123!',
    firstName: 'Read',
    lastName: 'Only',
    roleName: 'Viewer',
    isActive: true,
  },
  {
    username: 'hashem',
    email: 'hashem@feedfactory.local',
    password: '445566',
    firstName: 'Hashem',
    lastName: '',
    roleName: 'SuperAdmin',
    isActive: true,
  },
];

async function getOrCreateRole(roleName: string) {
  let role = await prisma.role.findUnique({
    where: { name: roleName },
  });

  if (!role) {
    const permissions = getDefaultPermissions(roleName);
    role = await prisma.role.create({
      data: {
        name: roleName,
        description: `${roleName} role`,
        color: getRoleColor(roleName),
        permissions: JSON.stringify(permissions),
      },
    });
    console.log(`Role ensured successfully: ${roleName}`);
  }

  return role;
}

function getDefaultPermissions(roleName: string): string[] {
  const allPermissions = [
    'users.view', 'users.create', 'users.update', 'users.delete', 'users.lock', 'users.audit',
    'inventory.view', 'inventory.create', 'inventory.update', 'inventory.delete',
    'sales.view', 'sales.create', 'sales.update', 'sales.delete',
    'reports.view', 'reports.export',
    'settings.view', 'settings.update',
  ];

  const rolePermissions: Record<string, string[]> = {
    SuperAdmin: allPermissions,
    Manager: ['users.view', 'inventory.view', 'inventory.create', 'inventory.update', 'reports.view', 'settings.view'],
    Storekeeper: ['inventory.view', 'inventory.create', 'reports.view'],
    Viewer: ['users.view', 'inventory.view', 'reports.view'],
  };

  return rolePermissions[roleName] || rolePermissions.Viewer;
}

function getRoleColor(roleName: string): string {
  const colors: Record<string, string> = {
    SuperAdmin: '#dc2626',
    Manager: '#2563eb',
    Storekeeper: '#059669',
    Viewer: '#6b7280',
  };
  return colors[roleName] || colors.Viewer;
}

async function seedUsers() {
  console.log('Starting unified users seed...\n');

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const userData of UNIFIED_USERS) {
    try {
      // Look up an existing user before creating or updating the record.
      const existingUser = await prisma.user.findUnique({
        where: { username: userData.username },
        include: { role: true },
      });

      // Ensure the role exists before assigning it to the user.
      const role = await getOrCreateRole(userData.roleName);

      // Hash the password before persisting the seeded user.
      const passwordHash = await bcrypt.hash(userData.password, 10);

      if (existingUser) {
        // Update the existing user record with the latest seeded values.
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            email: userData.email,
            passwordHash,
            firstName: userData.firstName,
            lastName: userData.lastName,
            roleId: role.id,
            isActive: userData.isActive,
            failedAttempts: 0,
            lockoutUntil: null,
          },
        });
        console.log(`User updated successfully: ${userData.username}`);
        updated++;
      } else {
        // Create the user when it does not already exist.
        await prisma.user.create({
          data: {
            username: userData.username,
            email: userData.email,
            passwordHash,
            firstName: userData.firstName,
            lastName: userData.lastName,
            roleId: role.id,
            isActive: userData.isActive,
            failedAttempts: 0,
            lockoutUntil: null,
          },
        });
        console.log(`User created successfully: ${userData.username}`);
        created++;
      }
    } catch (error: any) {
      console.error(`Failed to seed user ${userData.username}:`, error.message);
      skipped++;
    }
  }

  console.log('\nUnified users seed summary:');
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total configured users: ${UNIFIED_USERS.length}`);

  // Print the default login credentials for the seeded users.
  console.log('\nDefault credentials for seeded users:');
  const allUsers = await prisma.user.findMany({
    include: { role: true },
    orderBy: { createdAt: 'desc' },
  });

  console.table(
    allUsers.map(u => ({
      ID: u.id.substring(0, 8) + '...',
      Username: u.username,
      Email: u.email,
      Role: u.role.name,
      Status: u.isActive ? 'Active' : 'Inactive',
    }))
  );

  await prisma.$disconnect();
  console.log('\nUnified users seed completed successfully.');
}

// Exit with a non-zero code when the seed process fails.
seedUsers().catch((error) => {
  console.error('Unified users seed failed:', error);
  process.exit(1);
});
