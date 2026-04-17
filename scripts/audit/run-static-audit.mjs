import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectInventory } from './collect-inventory.mjs';
import {
  collectFiles,
  countLines,
  detectLocalEnvFiles,
  ensureDir,
  findFileLine,
  isExcludedRelativePath,
  listTrackedFiles,
  loadAuditConfig,
  makeFinding,
  redactSensitiveValue,
  resolveNodeModuleEntry,
  runCommand,
  sortFindings,
  summarizeCommandOutput,
  toPosix,
  writeJson,
  writeText,
} from './shared.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.prisma', '.json', '.md', '.yml', '.yaml', '.ps1']);

export function isPublicEndpointAllowed(route, allowlist = []) {
  const normalizedRoute = `/${String(route || '').replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return allowlist.includes(normalizedRoute);
}

export function extractControllerEndpoints(sourceText) {
  const lines = String(sourceText || '').split(/\r?\n/u);
  const endpoints = [];
  let controllerBase = '';
  let classHasGuards = false;
  let pendingDecorators = [];

  const flushMethod = (line, lineNumber) => {
    const httpDecorator = pendingDecorators.find((entry) => /^@(Get|Post|Put|Patch|Delete|Sse)\b/.test(entry.text));
    if (!httpDecorator) {
      pendingDecorators = [];
      return;
    }

    const routeMatch = httpDecorator.text.match(/^@(Get|Post|Put|Patch|Delete|Sse)(?:\((.*)\))?/);
    const methodPathLiteral = routeMatch?.[2]?.match(/['"`]([^'"`]+)['"`]/)?.[1] || '';
    const routePath = [controllerBase, methodPathLiteral]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .join('/')
      .replace(/\/+/g, '/');

    endpoints.push({
      method: routeMatch?.[1]?.toUpperCase() || 'UNKNOWN',
      route: `/${routePath.replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/',
      public: pendingDecorators.some((entry) => entry.text.startsWith('@Public')),
      hasPermissions: pendingDecorators.some((entry) => entry.text.startsWith('@Permissions')),
      hasRoles: pendingDecorators.some((entry) => entry.text.startsWith('@Roles')),
      hasMethodGuards: pendingDecorators.some((entry) => entry.text.startsWith('@UseGuards')),
      classHasGuards,
      line: httpDecorator.line || lineNumber,
      signature: line.trim(),
    });
    pendingDecorators = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('@UseGuards') && !lines.slice(index + 1, index + 4).some((entry) => /^\s*(async\s+)?[A-Za-z0-9_]+\(/.test(entry.trim()))) {
      classHasGuards = true;
    }

    if (trimmed.startsWith('@Controller')) {
      const match = trimmed.match(/@Controller\((.*)\)/);
      controllerBase = match?.[1]?.match(/['"`]([^'"`]*)['"`]/)?.[1] || '';
      pendingDecorators.push({ text: trimmed, line: index + 1 });
      continue;
    }

    if (trimmed.startsWith('@')) {
      pendingDecorators.push({ text: trimmed, line: index + 1 });
      continue;
    }

    if (/^(async\s+)?[A-Za-z0-9_]+\s*\(/.test(trimmed)) {
      flushMethod(line, index + 1);
      continue;
    }

    if (!trimmed) {
      continue;
    }
  }

  return endpoints;
}

export function calculateNormalizedLineSimilarity(leftSource, rightSource) {
  const normalize = (source) => new Set(
    String(source || '')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//') && !line.startsWith('import ') && !line.startsWith('export '))
      .map((line) => line.replace(/\s+/g, ' ')),
  );

  const leftSet = normalize(leftSource);
  const rightSet = normalize(rightSource);
  if (!leftSet.size || !rightSet.size) return 0;

  let shared = 0;
  for (const line of leftSet) {
    if (rightSet.has(line)) shared += 1;
  }

  return shared / Math.min(leftSet.size, rightSet.size);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? next : true;
    if (args[key] !== true) index += 1;
  }
  return args;
}

function relative(projectRoot, absolutePath) {
  return toPosix(path.relative(projectRoot, absolutePath));
}

function saveCommandLog(outputDir, name, result) {
  const logPath = path.join(outputDir, 'logs', `${name}.log`);
  const content = [
    `$ ${result.command}`,
    '',
    '--- stdout ---',
    result.stdout || '',
    '',
    '--- stderr ---',
    result.stderr || '',
    '',
    '--- error ---',
    result.error || '',
  ].join('\n');
  writeText(logPath, content);
  return logPath;
}

function addTypeScriptChecks({ findings, projectRoot, outputDir }) {
  const frontendTsc = resolveNodeModuleEntry(projectRoot, 'frontend', [
    'frontend/node_modules/typescript/bin/tsc',
    'node_modules/typescript/bin/tsc',
  ]);
  const backendTsc = resolveNodeModuleEntry(projectRoot, 'backend', [
    'backend/node_modules/typescript/bin/tsc',
    'node_modules/typescript/bin/tsc',
  ]);

  for (const check of [
    { name: 'frontend', entry: frontendTsc, args: ['-p', 'frontend/tsconfig.json', '--noEmit'] },
    { name: 'backend', entry: backendTsc, args: ['-p', 'backend/tsconfig.json', '--noEmit'] },
  ]) {
    if (!check.entry) {
      findings.push(makeFinding({
        severity: 'medium',
        category: 'tooling',
        ruleId: 'typescript-binary-missing',
        title: `TypeScript compiler not resolved for ${check.name}`,
        description: 'The surgical audit could not find the local TypeScript CLI for this workspace.',
        remediation: 'Ensure workspace dependencies are installed before running the audit.',
      }));
      continue;
    }

    const result = runCommand('node', [check.entry, ...check.args], {
      cwd: projectRoot,
      timeoutMs: 120000,
    });
    saveCommandLog(outputDir, `typecheck-${check.name}`, result);
    if (!result.ok) {
      findings.push(makeFinding({
        severity: 'high',
        category: 'quality',
        ruleId: 'typescript-typecheck-failed',
        title: `TypeScript typecheck failed in ${check.name}`,
        description: 'The workspace does not pass a no-emit TypeScript compilation pass.',
        evidence: summarizeCommandOutput(result),
        remediation: `Inspect logs/typecheck-${check.name}.log and fix the reported type errors.`,
      }));
    }
  }
}

function addPrismaChecks({ findings, projectRoot, outputDir }) {
  const prismaCli = resolveNodeModuleEntry(projectRoot, 'backend', [
    'backend/node_modules/prisma/build/index.js',
    'node_modules/prisma/build/index.js',
  ]);

  if (!prismaCli) {
    findings.push(makeFinding({
      severity: 'medium',
      category: 'tooling',
      ruleId: 'prisma-cli-missing',
      title: 'Prisma CLI not resolved',
      description: 'The surgical audit could not locate the local Prisma CLI needed for schema validation.',
    }));
    return;
  }

  const result = runCommand('node', [prismaCli, 'validate', '--schema', 'backend/prisma/schema.prisma'], {
    cwd: projectRoot,
    timeoutMs: 120000,
  });
  saveCommandLog(outputDir, 'prisma-validate', result);
  if (!result.ok) {
    findings.push(makeFinding({
      severity: 'high',
      category: 'database',
      ruleId: 'prisma-validate-failed',
      title: 'Prisma schema validation failed',
      description: 'The Prisma schema did not validate cleanly.',
      evidence: summarizeCommandOutput(result),
      remediation: 'Inspect logs/prisma-validate.log and fix schema or environment issues before deployment.',
    }));
  }
}

function addNpmAuditChecks({ findings, projectRoot, outputDir }) {
  const attempts = [
    { label: 'root', cwd: projectRoot },
    { label: 'frontend', cwd: path.join(projectRoot, 'frontend') },
    { label: 'backend', cwd: path.join(projectRoot, 'backend') },
  ];
  const parsedRuns = [];

  for (const attempt of attempts) {
    if (!fs.existsSync(attempt.cwd)) continue;
    const result = runCommand('npm', ['audit', '--json'], {
      cwd: attempt.cwd,
      timeoutMs: 180000,
    });
    saveCommandLog(outputDir, `npm-audit-${attempt.label}`, result);

    const parsed = (() => {
      try {
        return JSON.parse(result.stdout || '{}');
      } catch {
        return null;
      }
    })();

    parsedRuns.push({
      label: attempt.label,
      result,
      parsed,
    });
  }

  writeJson(path.join(outputDir, 'npm-audit.json'), parsedRuns.map((entry) => ({
    label: entry.label,
    ok: entry.result.ok,
    code: entry.result.code,
    parsed: entry.parsed,
    stderr: entry.result.stderr,
  })));

  const successfulRuns = parsedRuns.filter((entry) => entry.parsed?.metadata?.vulnerabilities);
  if (!successfulRuns.length) {
    const primary = parsedRuns[0]?.result;
    findings.push(makeFinding({
      severity: 'low',
      category: 'supply-chain',
      ruleId: 'npm-audit-unavailable',
      title: 'npm audit did not return structured vulnerability metadata',
      description: 'Dependency vulnerability scanning did not complete in a structured way.',
      evidence: primary ? summarizeCommandOutput(primary) : 'npm audit did not run',
      remediation: 'Run npm audit locally and inspect the workspace lockfiles or npm configuration before trusting supply-chain status.',
    }));
    return;
  }

  for (const entry of successfulRuns) {
    const vulnerabilities = entry.parsed.metadata.vulnerabilities;
    for (const severity of ['critical', 'high', 'moderate', 'low']) {
      const count = Number(vulnerabilities[severity] || 0);
      if (count <= 0) continue;
      findings.push(makeFinding({
        severity: severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : severity === 'moderate' ? 'medium' : 'low',
        category: 'supply-chain',
        ruleId: 'npm-audit-vulnerabilities',
        title: `npm audit reported ${count} ${severity} vulnerabilities in ${entry.label}`,
        description: 'Installed dependencies include reported security vulnerabilities.',
        evidence: `workspace=${entry.label}; severity=${severity}; count=${count}`,
        remediation: 'Review npm-audit.json and remediate or explicitly accept the vulnerable packages.',
      }));
    }
  }
}

function addToolingPresenceChecks({ findings, projectRoot }) {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const frontendPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'frontend/package.json'), 'utf8'));
  const backendPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'backend/package.json'), 'utf8'));
  const scriptMaps = [rootPackage.scripts || {}, frontendPackage.scripts || {}, backendPackage.scripts || {}];
  const hasLintScript = scriptMaps.some((scripts) => Object.prototype.hasOwnProperty.call(scripts, 'lint'));
  const eslintConfigCandidates = [
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.cjs',
    'eslint.config.js',
    'eslint.config.mjs',
    'frontend/eslint.config.js',
    'backend/eslint.config.js',
  ];
  const hasEslintConfig = eslintConfigCandidates.some((candidate) => fs.existsSync(path.join(projectRoot, candidate)));

  if (!hasLintScript || !hasEslintConfig) {
    findings.push(makeFinding({
      severity: 'medium',
      category: 'tooling',
      ruleId: 'lint-pipeline-missing',
      title: 'Lint pipeline is not configured end-to-end',
      description: 'The repo currently lacks a complete lint command and ESLint configuration for the main workspaces.',
      evidence: `hasLintScript=${hasLintScript}; hasEslintConfig=${hasEslintConfig}`,
      remediation: 'Add a lint script and a shared ESLint configuration so audit quality gates are enforceable.',
    }));
  }
}

function addLocalEnvChecks({ findings, projectRoot, config }) {
  for (const envFile of detectLocalEnvFiles(projectRoot, config)) {
    findings.push(makeFinding({
      severity: 'low',
      category: 'configuration',
      ruleId: 'local-env-present',
      title: `Local environment file present: ${envFile.relativePath}`,
      description: 'A local environment file exists on disk. The audit intentionally reports its presence without exposing values.',
      file: envFile.relativePath,
      remediation: 'Keep the file untracked and verify it only contains local or secret-managed values.',
    }));
  }
}

function addTrackedSecretsChecks({ findings, projectRoot, config }) {
  const trackedFiles = listTrackedFiles(projectRoot).filter((filePath) => {
    const relativePath = relative(projectRoot, filePath);
    return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) && !isExcludedRelativePath(relativePath, config.excludedPaths);
  });
  const hardcodedSecretRegex = /\b(JWT_SECRET|POSTGRES_PASSWORD|DATABASE_URL|RESET_TOKEN|BACKUP_ENCRYPTION_SECRET|ADMIN_PASSWORD|METRICS_AUTH_TOKEN)\b\s*[:=]\s*.+/i;

  for (const filePath of trackedFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!hardcodedSecretRegex.test(line)) continue;

      findings.push(makeFinding({
        severity: /docker-compose/i.test(filePath) ? 'high' : 'medium',
        category: 'security',
        ruleId: 'hardcoded-secret',
        title: 'Tracked file contains a hardcoded secret-like assignment',
        description: 'The file appears to embed a secret or credential directly in tracked source/configuration.',
        file: relative(projectRoot, filePath),
        line: index + 1,
        evidence: redactSensitiveValue(line.trim(), config),
        remediation: 'Move the value to secret management or a non-tracked runtime environment file.',
      }));
    }
  }
}

function addPrismaRawSqlChecks({ findings, projectRoot, config }) {
  const backendFiles = collectFiles(path.join(projectRoot, 'backend'), {
    extensions: ['.ts', '.tsx', '.js'],
    excludedPatterns: config.excludedPaths,
  });

  for (const filePath of backendFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const token of ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']) {
      const line = findFileLine(source, (entry) => entry.includes(token));
      if (!source.includes(token)) continue;
      findings.push(makeFinding({
        severity: token.endsWith('Unsafe') ? 'critical' : 'high',
        category: 'security',
        ruleId: 'prisma-raw-sql',
        title: `Prisma raw SQL usage detected (${token})`,
        description: 'Raw SQL bypasses Prisma safety rails and requires explicit review for SQL injection risk.',
        file: relative(projectRoot, filePath),
        line,
        evidence: token,
        remediation: 'Prefer Prisma query builders, or isolate and parameterize raw SQL with compensating controls.',
      }));
    }
  }
}

function addPublicEndpointChecks({ findings, projectRoot, config }) {
  const controllerFiles = collectFiles(path.join(projectRoot, 'backend/src'), {
    extensions: ['.ts'],
    excludedPatterns: config.excludedPaths,
  }).filter((filePath) => /controller\.ts$/i.test(filePath));

  for (const filePath of controllerFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const endpoints = extractControllerEndpoints(source);
    for (const endpoint of endpoints) {
      if (endpoint.public && !isPublicEndpointAllowed(endpoint.route, config.publicEndpointsAllowlist)) {
        findings.push(makeFinding({
          severity: 'high',
          category: 'security',
          ruleId: 'unexpected-public-endpoint',
          title: 'Unexpected public endpoint detected',
          description: 'A public endpoint exists outside the configured allowlist.',
          file: relative(projectRoot, filePath),
          line: endpoint.line,
          evidence: `${endpoint.method} ${endpoint.route}`,
          remediation: 'Either secure the endpoint with guards or add it explicitly to the audit allowlist with justification.',
        }));
      }

      if (!endpoint.public && !endpoint.hasPermissions && !endpoint.hasRoles) {
        findings.push(makeFinding({
          severity: 'low',
          category: 'authorization',
          ruleId: 'missing-endpoint-permission',
          title: 'Authenticated endpoint has no explicit permission or role decorator',
          description: 'The endpoint relies on authentication only and does not declare endpoint-level RBAC metadata.',
          file: relative(projectRoot, filePath),
          line: endpoint.line,
          evidence: `${endpoint.method} ${endpoint.route}`,
          remediation: 'Add @Permissions or @Roles, or document why any authenticated user should access this route.',
        }));
      }
    }
  }
}

function addSocketChecks({ findings, projectRoot, config }) {
  const realtimeGatewayPath = path.join(projectRoot, 'backend/src/realtime/realtime.gateway.ts');
  if (!fs.existsSync(realtimeGatewayPath)) return;

  const source = fs.readFileSync(realtimeGatewayPath, 'utf8');
  const authSignals = ['verifyToken', 'JwtAuthGuard', 'Authorization', 'cookie', 'handshake.auth', 'handshake.headers', 'authService'];
  const hasAuthSignal = authSignals.some((signal) => source.includes(signal));

  if (!hasAuthSignal) {
    findings.push(makeFinding({
      severity: 'critical',
      category: 'security',
      ruleId: 'socket-auth-gap',
      title: 'Socket.IO gateway does not show an authentication check',
      description: 'The realtime gateway accepts connections without an observable authentication or session validation step.',
      file: relative(projectRoot, realtimeGatewayPath),
      line: findFileLine(source, (line) => line.includes('handleConnection')),
      evidence: `namespace=${config.runtime?.socketNamespace || '/realtime'}`,
      remediation: 'Validate the handshake against the same auth/session policy used by HTTP endpoints before accepting the client.',
    }));
  }
}

function addCookieTokenDriftCheck({ findings, projectRoot }) {
  const frontendClientPath = path.join(projectRoot, 'frontend/src/api/client.ts');
  const authGuardPath = path.join(projectRoot, 'backend/src/auth/jwt-auth.guard.ts');
  if (!fs.existsSync(frontendClientPath) || !fs.existsSync(authGuardPath)) return;

  const frontendSource = fs.readFileSync(frontendClientPath, 'utf8');
  const backendSource = fs.readFileSync(authGuardPath, 'utf8');
  const frontendUsesLocalStorageToken = frontendSource.includes("localStorage.getItem('feed_factory_jwt_token')");
  const backendCookieOnly = backendSource.includes("request?.cookies?.['feed_factory_jwt']") && !backendSource.includes('authorization');

  if (frontendUsesLocalStorageToken && backendCookieOnly) {
    findings.push(makeFinding({
      severity: 'high',
      category: 'security',
      ruleId: 'auth-token-drift',
      title: 'Frontend token storage drifts from backend cookie-only policy',
      description: 'The frontend still reads a JWT from localStorage while the backend guard authenticates from the HTTP-only cookie only.',
      file: 'frontend/src/api/client.ts',
      line: findFileLine(frontendSource, (line) => line.includes("feed_factory_jwt_token")),
      evidence: "localStorage.getItem('feed_factory_jwt_token')",
      remediation: 'Remove the stale localStorage token path or make the transport policy explicit and consistent on both sides.',
    }));
  }
}

function addSensitiveLoggingChecks({ findings, projectRoot, config }) {
  const files = collectFiles(projectRoot, {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
    excludedPatterns: config.excludedPaths,
  });
  const interestingRegex = /console\.(log|warn|error)\(/;
  const sensitiveRegex = /\b(auth|login|password|token|cookie|session|reset)\b/i;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!interestingRegex.test(line) || !sensitiveRegex.test(line)) continue;
      findings.push(makeFinding({
        severity: 'medium',
        category: 'security',
        ruleId: 'sensitive-console-logging',
        title: 'Sensitive-flow console logging detected',
        description: 'A console statement appears inside an auth, login, token, password, cookie, or session-related flow.',
        file: relative(projectRoot, filePath),
        line: index + 1,
        evidence: line.trim(),
        remediation: 'Route security-sensitive diagnostics through structured logging with redaction, or remove them in production paths.',
      }));
    }
  }
}

function addAnyHotspotChecks({ findings, projectRoot, config }) {
  const files = collectFiles(projectRoot, {
    extensions: ['.ts', '.tsx'],
    excludedPatterns: config.excludedPaths,
  });

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const matches = source.match(/:\s*any\b|\bas any\b/g) || [];
    if (matches.length < 4) continue;

    findings.push(makeFinding({
      severity: matches.length >= 12 ? 'high' : 'medium',
      category: 'type-safety',
      ruleId: 'any-hotspot',
      title: `Type safety hotspot: ${matches.length} any-casts/usages`,
      description: 'This file relies heavily on any, reducing type safety and audit confidence.',
      file: relative(projectRoot, filePath),
      line: 1,
      evidence: `anyUsages=${matches.length}`,
      remediation: 'Replace broad any usage with DTOs, generics, discriminated unions, or unknown with narrowing.',
    }));
  }
}

function addGiantComponentChecks({ findings, inventory, config }) {
  for (const component of inventory.giantComponents) {
    if (component.lines < config.reactComponentThresholds.warningLines) continue;
    findings.push(makeFinding({
      severity: component.lines >= config.reactComponentThresholds.highLines ? 'high' : 'medium',
      category: 'architecture',
      ruleId: 'giant-react-component',
      title: `Large React surface detected (${component.lines} lines)`,
      description: 'This React page/component exceeds the configured maintainability threshold.',
      file: component.path,
      line: 1,
      evidence: `lines=${component.lines}`,
      remediation: 'Split the surface into focused sections, extract hooks, and isolate side-effects from rendering.',
    }));
  }
}

function addDuplicateSurfaceChecks({ findings, projectRoot, config }) {
  const candidates = collectFiles(path.join(projectRoot, 'frontend/src'), {
    extensions: ['.tsx'],
    excludedPatterns: config.excludedPaths,
  }).filter((filePath) => countLines(filePath) >= 500);

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const leftFile = candidates[leftIndex];
      const rightFile = candidates[rightIndex];
      const leftSource = fs.readFileSync(leftFile, 'utf8');
      const rightSource = fs.readFileSync(rightFile, 'utf8');
      const similarity = calculateNormalizedLineSimilarity(leftSource, rightSource);
      if (similarity < 0.58) continue;

      findings.push(makeFinding({
        severity: similarity >= 0.78 ? 'high' : 'medium',
        category: 'architecture',
        ruleId: 'duplicate-large-surface',
        title: 'Large React surfaces appear substantially duplicated',
        description: 'Two large files share a high proportion of normalized lines, suggesting duplicated product logic or forked UI.',
        file: relative(projectRoot, leftFile),
        line: 1,
        evidence: `${relative(projectRoot, leftFile)} <-> ${relative(projectRoot, rightFile)}; similarity=${similarity.toFixed(2)}`,
        remediation: 'Converge the shared behavior into a common module or clearly separate the responsibilities of the duplicated views.',
      }));
    }
  }
}

function addReadmeDriftChecks({ findings, projectRoot }) {
  const readmePath = path.join(projectRoot, 'README.md');
  const prismaPath = path.join(projectRoot, 'backend/prisma/schema.prisma');
  if (!fs.existsSync(readmePath) || !fs.existsSync(prismaPath)) return;

  const readme = fs.readFileSync(readmePath, 'utf8');
  const schema = fs.readFileSync(prismaPath, 'utf8');
  const usesPostgres = /provider\s*=\s*"postgresql"/i.test(schema);

  if (usesPostgres && /SQLite \(Development\)/i.test(readme)) {
    findings.push(makeFinding({
      severity: 'medium',
      category: 'documentation',
      ruleId: 'readme-db-drift',
      title: 'README database guidance drifts from Prisma reality',
      description: 'README still documents SQLite for development while Prisma is configured for PostgreSQL.',
      file: 'README.md',
      line: findFileLine(readme, (line) => /SQLite \(Development\)/i.test(line)),
      evidence: 'README says SQLite (Development); Prisma datasource says postgresql',
      remediation: 'Align the README with the actual supported development database flow.',
    }));
  }

  for (const missingPath of ['_PROJECT_DOCS', 'run-system.sh', 'run-system.ps1']) {
    if (readme.includes(missingPath) && !fs.existsSync(path.join(projectRoot, missingPath))) {
      findings.push(makeFinding({
        severity: 'low',
        category: 'documentation',
        ruleId: 'readme-missing-path',
        title: `README references missing path: ${missingPath}`,
        description: 'README currently points to a file or directory that is not present in the repository.',
        file: 'README.md',
        line: findFileLine(readme, (line) => line.includes(missingPath)),
        evidence: missingPath,
        remediation: 'Update the README or restore the referenced asset.',
      }));
    }
  }
}

function addAuditTrailCoverageChecks({ findings, projectRoot, config }) {
  const serviceFiles = collectFiles(path.join(projectRoot, 'backend/src'), {
    extensions: ['.ts'],
    excludedPatterns: config.excludedPaths,
  }).filter((filePath) => /service\.ts$/i.test(filePath));

  const mutationRegex = /\.(create|update|delete|deleteMany|createMany|updateMany)\s*\(/g;
  for (const filePath of serviceFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const mutations = source.match(mutationRegex) || [];
    if (!mutations.length) continue;
    if (/audit(Service|Log)|logItemAction|auditLog\./i.test(source)) continue;

    findings.push(makeFinding({
      severity: 'medium',
      category: 'auditability',
      ruleId: 'mutation-without-audit-trace',
      title: 'Mutation-heavy service lacks obvious audit logging',
      description: 'This backend service performs create/update/delete operations without an obvious audit trail call.',
      file: relative(projectRoot, filePath),
      line: 1,
      evidence: `mutations=${mutations.length}`,
      remediation: 'Review whether these mutations should emit structured audit records for ERP traceability.',
    }));
  }
}

export async function runStaticAudit({ projectRoot, configPath, outputDir }) {
  ensureDir(outputDir);
  const config = loadAuditConfig(configPath);
  const inventory = collectInventory({ projectRoot, config });
  const findings = [];

  writeJson(path.join(outputDir, 'inventory.json'), inventory);
  addToolingPresenceChecks({ findings, projectRoot });
  addTypeScriptChecks({ findings, projectRoot, outputDir });
  addPrismaChecks({ findings, projectRoot, outputDir });
  addNpmAuditChecks({ findings, projectRoot, outputDir });
  addLocalEnvChecks({ findings, projectRoot, config });
  addTrackedSecretsChecks({ findings, projectRoot, config });
  addPrismaRawSqlChecks({ findings, projectRoot, config });
  addPublicEndpointChecks({ findings, projectRoot, config });
  addSocketChecks({ findings, projectRoot, config });
  addCookieTokenDriftCheck({ findings, projectRoot });
  addSensitiveLoggingChecks({ findings, projectRoot, config });
  addAnyHotspotChecks({ findings, projectRoot, config });
  addGiantComponentChecks({ findings, inventory, config });
  addDuplicateSurfaceChecks({ findings, projectRoot, config });
  addReadmeDriftChecks({ findings, projectRoot });
  addAuditTrailCoverageChecks({ findings, projectRoot, config });

  const report = {
    stage: 'static',
    generatedAt: new Date().toISOString(),
    inventory,
    findings: sortFindings(findings),
    counts: findings.reduce((accumulator, finding) => {
      accumulator[finding.severity] = (accumulator[finding.severity] || 0) + 1;
      return accumulator;
    }, {}),
  };

  writeJson(path.join(outputDir, 'static-report.json'), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv);
  const projectRoot = path.resolve(String(args['project-root'] || process.cwd()));
  const configPath = path.resolve(String(args.config || path.join(projectRoot, 'scripts/audit/audit.config.json')));
  const outputDir = path.resolve(String(args['output-dir'] || path.join(projectRoot, 'audit-reports/surgical/manual')));
  const report = await runStaticAudit({ projectRoot, configPath, outputDir });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
