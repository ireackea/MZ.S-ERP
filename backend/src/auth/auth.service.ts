// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
// FINAL ENTERPRISE FIX: Auto-Seed Admin Complete - 2026-02-26
// 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½â¬©7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ - Auto-Seed SuperAdmin + JWT Authentication

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - 2026-03-02
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';

type JwtUser = {
  id: string;
  username: string;
  role: string;
  permissions: string[];
  name?: string | null;
  sessionId?: string;
};

const DEFAULT_ROLES: Array<{
  name: string;
  description: string;
  permissions: string[];
  color: string;
}> = [
  { name: 'SuperAdmin', description: '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½', permissions: ['*'], color: '#ef4444' },
  {
    name: 'Admin',
    description: '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½â¬©7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½',
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
    description: '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½â¬©7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½â¬©7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½ï؟½"7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½',
    permissions: ['transactions.*', 'reports.view', 'items.view', 'opening-balances.view', 'backup.view'],
    color: '#10b981',
  },
  {
    name: 'Operator',
    description: '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½7:7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½7:7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½',
    permissions: ['transactions.create', 'transactions.update', 'transactions.delete', 'transactions.view', 'items.view'],
    color: '#f59e0b',
  },
  {
    name: 'Viewer',
    description: '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½â¬©7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½ï؟½"7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½â¬©7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½',
    permissions: ['items.view', 'transactions.view', 'reports.view', 'opening-balances.view', 'backup.view'],
    color: '#6b7280',
  },
];

@Injectable()
export class AuthService {
  private readonly auditService = new AuditService();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private getJwtSecret(): string {
    return process.env.JWT_SECRET || process.env.ADMIN_TOKEN || 'feedfactory-dev-secret';
  }

  private getDefaultAdminPassword(): string {
    return process.env.ADMIN_PASSWORD || 'SecurePassword2026!';
  }

  private getMaxFailedAttempts(): number {
    const parsed = Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
  }

  private getLockoutMinutes(): number {
    const parsed = Number(process.env.AUTH_LOCKOUT_MINUTES || 15);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 15;
  }

  private getSessionTimeoutMinutes(): number {
    const parsed = Number(process.env.AUTH_SESSION_TIMEOUT_MINUTES || 30);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
  }

  private validatePasswordPolicy(password: string) {
    const candidate = String(password || '');
    const hasMinLength = candidate.length >= 8;
    const hasUpper = /[A-Z]/.test(candidate);
    const hasLower = /[a-z]/.test(candidate);
    const hasDigit = /\d/.test(candidate);
    const hasSpecial = /[^A-Za-z0-9]/.test(candidate);

    return hasMinLength && hasUpper && hasLower && hasDigit && hasSpecial;
  }

  private resolveClientIp(clientMeta?: { ipAddress?: string }) {
    return String(clientMeta?.ipAddress || '0.0.0.0');
  }

  private resolveUserAgent(clientMeta?: { userAgent?: string }) {
    return String(clientMeta?.userAgent || 'unknown');
  }

  private resolveDeviceFingerprint(username: string, clientMeta?: { deviceFingerprint?: string; userAgent?: string }) {
    const supplied = String(clientMeta?.deviceFingerprint || '').trim();
    if (supplied) return supplied;
    const ua = String(clientMeta?.userAgent || 'unknown');
    return `fallback-${Buffer.from(`${username}|${ua}`).toString('base64').slice(0, 48)}`;
  }

  private normalizePermissions(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is string => typeof entry === 'string');
    } catch {
      return [];
    }
  }

  private async ensureDefaultRoles() {
    for (const role of DEFAULT_ROLES) {
      await this.prisma.role.upsert({
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
  }

  private async reconcileSuperAdminAccount(
    user: {
      id: string;
      roleId: string;
      passwordHash: string;
      failedAttempts: number;
      lockoutUntil: Date | null;
      isActive: boolean;
    },
    superAdminRoleId: string,
  ) {
    const updates: {
      roleId?: string;
      passwordHash?: string;
      failedAttempts?: number;
      lockoutUntil?: Date | null;
      isActive?: boolean;
    } = {};

    if (user.roleId !== superAdminRoleId) {
      updates.roleId = superAdminRoleId;
    }

    const defaultAdminPassword = this.getDefaultAdminPassword();
    const isPasswordSynced = await this.verifyPassword(defaultAdminPassword, user.passwordHash);
    if (!isPasswordSynced) {
      updates.passwordHash = await bcrypt.hash(defaultAdminPassword, 10);
      updates.failedAttempts = 0;
      updates.lockoutUntil = null;
      updates.isActive = true;
      console.warn('[Auth Service] SuperAdmin password synchronized from ADMIN_PASSWORD.');
    } else if ((user.failedAttempts || 0) > 0 || user.lockoutUntil || user.isActive === false) {
      updates.failedAttempts = 0;
      updates.lockoutUntil = null;
      updates.isActive = true;
    }

    if (Object.keys(updates).length > 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: updates,
      });
    }
  }

  private async ensureDefaultAdmin() {
    await this.ensureDefaultRoles();
    const superAdminRole = await this.prisma.role.findUnique({ where: { name: 'SuperAdmin' } });
    if (!superAdminRole) {
      console.error('7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½ï؟½7ï؟½"ï؟½#ï؟½â¬‘"ï؟½#ï؟½ï؟½ï؟½%7ï؟½"ï؟½7ï؟½"ï؟½ [Auth Service] SuperAdmin role not found!');
      return;
    }

    const adminByUsername = await this.prisma.user.findUnique({
      where: { username: 'superadmin' },
      select: {
        id: true,
        roleId: true,
        passwordHash: true,
        failedAttempts: true,
        lockoutUntil: true,
        isActive: true,
      },
    });
    if (adminByUsername) {
      await this.reconcileSuperAdminAccount(adminByUsername, superAdminRole.id);
      return;
    }

    const adminByEmail = await this.prisma.user.findFirst({
      where: { email: 'superadmin@feedfactory.local' },
      select: {
        id: true,
        username: true,
        roleId: true,
        passwordHash: true,
        failedAttempts: true,
        lockoutUntil: true,
        isActive: true,
      },
    });
    if (adminByEmail) {
      await this.prisma.user.update({
        where: { id: adminByEmail.id },
        data: {
          username: adminByEmail.username || 'superadmin',
          roleId: superAdminRole.id,
        },
      });
      await this.reconcileSuperAdminAccount(adminByEmail, superAdminRole.id);
      return;
    }

    const passwordHash = await bcrypt.hash(this.getDefaultAdminPassword(), 10);
    await this.prisma.user.create({
      data: {
        username: 'superadmin',
        email: 'superadmin@feedfactory.local',
        passwordHash,
        firstName: 'System',
        lastName: 'SuperAdmin',
        isActive: true,
        roleId: superAdminRole.id,
      },
    });
    console.log('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½%7ï؟½"ï؟½#ï؟½â¬‘"ï؟½7ï؟½"ï؟½ [Auth Service] SuperAdmin Seeded Successfully!');
  }

  private async verifyPassword(plain: string, hash: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return plain === hash;
    }
  }

  async login(
    username: string,
    password: string,
    clientMeta?: { deviceFingerprint?: string; ipAddress?: string; userAgent?: string },
  ) {
    const normalized = String(username || '').trim();
    const invalidCredentialsMessage = 'اسم المستخدم أو كلمة المرور غير صحيحة.';
    const accountLockedMessage = 'الحساب مقفل مؤقتاً بسبب محاولات دخول متكررة. حاول لاحقاً.';
    const maxFailedAttempts = this.getMaxFailedAttempts();
    const lockoutMinutes = this.getLockoutMinutes();

    console.log(`[Auth Service] Login attempt for username/email: ${normalized || '<empty>'}`);

    // Keep admin/role bootstrap non-blocking for login to avoid unnecessary 500 errors.
    try {
      await this.ensureDefaultAdmin();
    } catch (seedError: any) {
      console.warn('[Auth Service] ensureDefaultAdmin skipped due to runtime error:', seedError?.message || seedError);
    }

    let user: any;
    try {
      user = await this.prisma.user.findFirst({
        where: {
          OR: [{ username: normalized }, { email: normalized }],
        },
        include: {
          role: {
            select: {
              name: true,
              permissions: true,
            },
          },
        },
      });
    } catch (queryError: any) {
      console.error('[Auth Service] Failed to load user during login:', queryError?.message || queryError);
      throw new UnauthorizedException('تعذر التحقق من بيانات الدخول حالياً. يرجى المحاولة لاحقاً.');
    }

    if (!user || user.isActive === false) {
      await this.auditService.log({
        action: 'LOGIN_FAILED',
        actorId: 'anonymous',
        actorUsername: normalized || 'anonymous',
        actorRole: 'anonymous',
        targetResource: 'auth.login',
        status: 'failed',
        message: 'Login failed: invalid credentials or inactive user',
        metadata: { ipAddress: this.resolveClientIp(clientMeta), userAgent: this.resolveUserAgent(clientMeta) },
      });
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    const now = Date.now();
    if (user.lockoutUntil && user.lockoutUntil.getTime() <= now && (user.failedAttempts || 0) > 0) {
      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedAttempts: 0, lockoutUntil: null },
        });
      } catch (resetError: any) {
        console.warn('[Auth Service] Failed to reset expired lockout metadata:', resetError?.message || resetError);
      }
      user.failedAttempts = 0;
      user.lockoutUntil = null;
    }

    if (user.lockoutUntil && user.lockoutUntil.getTime() > now) {
      await this.auditService.log({
        action: 'LOGIN_LOCKED',
        actorId: user.id,
        actorUsername: user.username || user.email || normalized || 'unknown',
        actorRole: user.role?.name || 'Viewer',
        targetUserId: user.id,
        targetResource: 'auth.login',
        status: 'failed',
        message: 'Login blocked: account is currently locked',
      });
      throw new UnauthorizedException(accountLockedMessage);
    }

    const valid = await this.verifyPassword(password, user.passwordHash);
    if (!valid) {
      const currentAttempts = Math.max(0, Number(user.failedAttempts || 0));
      const attempts = currentAttempts + 1;
      const shouldLock = attempts >= maxFailedAttempts;

      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedAttempts: shouldLock ? maxFailedAttempts : attempts,
            lockoutUntil: shouldLock ? new Date(Date.now() + lockoutMinutes * 60 * 1000) : null,
          },
        });
      } catch (attemptsUpdateError: any) {
        console.warn('[Auth Service] Failed to update failedAttempts/lockout metadata:', attemptsUpdateError?.message || attemptsUpdateError);
      }

      await this.auditService.log({
        action: shouldLock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        actorId: user.id,
        actorUsername: user.username || user.email || normalized || 'unknown',
        actorRole: user.role?.name || 'Viewer',
        targetUserId: user.id,
        targetResource: 'auth.login',
        status: 'failed',
        message: shouldLock
          ? `Login failed and account locked after ${attempts} attempts`
          : `Login failed (attempt ${attempts}/${maxFailedAttempts})`,
      });

      throw new UnauthorizedException(shouldLock ? accountLockedMessage : invalidCredentialsMessage);
    }

    if (!this.validatePasswordPolicy(password)) {
      await this.auditService.log({
        action: 'PASSWORD_POLICY_VIOLATION',
        actorId: user.id,
        actorUsername: user.username || user.email || normalized || 'unknown',
        actorRole: user.role?.name || 'Viewer',
        targetUserId: user.id,
        targetResource: 'auth.login',
        status: 'failed',
        message: 'Rejected login due to weak password policy',
      });
      throw new BadRequestException('كلمة المرور لا تحقق سياسة الأمان المطلوبة.');
    }

    // Upgrade legacy plain password hash to bcrypt/reset lock state without breaking login flow.
    try {
      if (!String(user.passwordHash).startsWith('$2')) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: await bcrypt.hash(password, 10),
            failedAttempts: 0,
            lockoutUntil: null,
          },
        });
      } else if ((user.failedAttempts || 0) > 0 || user.lockoutUntil) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedAttempts: 0, lockoutUntil: null },
        });
      }
    } catch (postAuthUpdateError: any) {
      console.warn('[Auth Service] Post-auth user metadata update skipped:', postAuthUpdateError?.message || postAuthUpdateError);
    }

    const permissions = this.normalizePermissions(user.role?.permissions);
    const sessionTimeoutMinutes = this.getSessionTimeoutMinutes();
    const sessionExpiresAt = new Date(Date.now() + sessionTimeoutMinutes * 60 * 1000);
    const sessionId = randomUUID();
    const deviceFingerprint = this.resolveDeviceFingerprint(normalized, clientMeta);

    await this.auditService.createSession({
      sessionId,
      userId: user.id,
      username: user.username || user.email || normalized || 'user',
      role: user.role?.name || 'Viewer',
      deviceFingerprint,
      ipAddress: this.resolveClientIp(clientMeta),
      userAgent: this.resolveUserAgent(clientMeta),
      expiresAt: sessionExpiresAt,
    });

    await this.auditService.log({
      action: 'SESSION_CREATED',
      actorId: user.id,
      actorUsername: user.username || user.email || normalized || 'user',
      actorRole: user.role?.name || 'Viewer',
      targetUserId: user.id,
      targetResource: 'auth.session',
      status: 'success',
      message: 'New authenticated session created',
      metadata: {
        sessionId,
        expiresAt: sessionExpiresAt.toISOString(),
        deviceFingerprint,
      },
    });

    const payload = {
      sub: user.id,
      username: user.username || user.email || 'user',
      role: user.role?.name || 'Viewer',
      permissions,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || null,
      sid: sessionId,
    };
    const jwtExpiresIn = (process.env.JWT_EXPIRES_IN || '24h') as any;

    let accessToken: string;
    try {
      accessToken = await this.jwtService.signAsync(payload, {
        secret: this.getJwtSecret(),
        expiresIn: jwtExpiresIn,
      });
    } catch (jwtError: any) {
      console.error('[Auth Service] JWT signing failed:', jwtError?.message || jwtError);
      throw new UnauthorizedException('تعذر إنشاء جلسة الدخول. يرجى المحاولة لاحقاً.');
    }

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: String(jwtExpiresIn),
      sessionId,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      user: {
        id: user.id,
        username: user.username || user.email || 'user',
        role: user.role?.name || 'Viewer',
        permissions,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
      },
    };
  }
  async verifyToken(token: string): Promise<JwtUser> {
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.getJwtSecret(),
    });

    const sessionId = payload?.sid ? String(payload.sid) : undefined;
    const userId = String(payload?.sub || '');

    if (sessionId && userId) {
      const sessions = await this.auditService.listActiveSessions(userId);
      const active = sessions.find((entry) => entry.id === sessionId);
      if (!active) {
        await this.auditService.log({
          action: 'SESSION_EXPIRED',
          actorId: userId,
          actorUsername: String(payload?.username || 'unknown'),
          actorRole: String(payload?.role || 'Viewer'),
          targetUserId: userId,
          targetResource: 'auth.verify',
          status: 'failed',
          message: 'Token verification failed due to expired/revoked session',
        });
        throw new UnauthorizedException('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');
      }
      await this.auditService.touchSession(sessionId);
    }

    return {
      id: userId,
      username: String(payload?.username || ''),
      role: String(payload?.role || 'user'),
      permissions: Array.isArray(payload?.permissions)
        ? payload.permissions.filter((entry: unknown): entry is string => typeof entry === 'string')
        : [],
      name: payload?.name ? String(payload.name) : undefined,
      sessionId,
    };
  }
}


