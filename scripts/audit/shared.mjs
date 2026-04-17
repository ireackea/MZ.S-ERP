import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
export const severityWeights = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
  info: 0,
};

export function severityRank(severity) {
  return severityOrder.length - severityOrder.indexOf(String(severity || 'info'));
}

export function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function readJson(filePath, fallback = null) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, 'utf8');
}

function resolveCommandName(command) {
  if (process.platform !== 'win32') return command;
  if (/\.(cmd|exe|bat|ps1)$/i.test(command)) return command;
  if (['npm', 'npx'].includes(command)) return `${command}.cmd`;
  return command;
}

function quoteForCmd(arg) {
  const value = String(arg ?? '');
  if (!/[\s"&<>|^]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function runCommand(command, args = [], options = {}) {
  const resolvedCommand = resolveCommandName(command);
  const isWindowsBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedCommand);
  const result = isWindowsBatch
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `${quoteForCmd(resolvedCommand)} ${args.map(quoteForCmd).join(' ')}`.trim()], {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf8',
        shell: false,
        timeout: options.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      })
    : spawnSync(resolvedCommand, args, {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf8',
        shell: false,
        timeout: options.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      });

  return {
    ok: result.status === 0,
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.message || result.error) : '',
    command: `${command} ${args.join(' ')}`.trim(),
  };
}

export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegex(pattern) {
  return new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, '.*')}$`, 'i');
}

export function isExcludedRelativePath(relativePath, excludedPatterns = []) {
  const normalized = toPosix(relativePath).replace(/^\.?\//, '');
  if (!normalized) return false;

  return excludedPatterns.some((pattern) => {
    const normalizedPattern = toPosix(pattern).replace(/^\.?\//, '');
    if (!normalizedPattern) return false;

    if (normalizedPattern.includes('/')) {
      const regex = wildcardToRegex(normalizedPattern);
      return regex.test(normalized) || normalized.startsWith(`${normalizedPattern}/`);
    }

    const segmentRegex = wildcardToRegex(normalizedPattern);
    return normalized.split('/').some((segment) => segmentRegex.test(segment));
  });
}

export function collectFiles(projectRoot, options = {}) {
  const files = [];
  const extensions = new Set((options.extensions || []).map((entry) => entry.toLowerCase()));
  const excluded = options.excludedPatterns || [];

  function walk(currentPath) {
    const relativePath = toPosix(path.relative(projectRoot, currentPath));
    if (relativePath && isExcludedRelativePath(relativePath, excluded)) {
      return;
    }

    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
      if (!extensions.size || extensions.has(path.extname(currentPath).toLowerCase())) {
        files.push(currentPath);
      }
      return;
    }

    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      walk(path.join(currentPath, entry.name));
    }
  }

  walk(projectRoot);
  return files;
}

export function loadAuditConfig(configPath) {
  const config = readJson(configPath, {});
  return {
    excludedPaths: Array.isArray(config?.excludedPaths) ? config.excludedPaths : [],
    publicEndpointsAllowlist: Array.isArray(config?.publicEndpointsAllowlist) ? config.publicEndpointsAllowlist : [],
    reactComponentThresholds: config?.reactComponentThresholds || { warningLines: 300, highLines: 800 },
    localEnvFiles: Array.isArray(config?.localEnvFiles) ? config.localEnvFiles : [],
    redactionKeys: Array.isArray(config?.redactionKeys) ? config.redactionKeys : [],
    runtime: config?.runtime || {},
  };
}

export function listTrackedFiles(projectRoot) {
  const gitResult = runCommand('git', ['ls-files'], { cwd: projectRoot, timeoutMs: 20000 });
  if (!gitResult.ok) return [];

  return gitResult.stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.join(projectRoot, entry))
    .filter((entry) => fs.existsSync(entry));
}

export function detectLocalEnvFiles(projectRoot, config) {
  return (config.localEnvFiles || [])
    .map((relativePath) => ({
      relativePath: toPosix(relativePath),
      absolutePath: path.join(projectRoot, relativePath),
    }))
    .filter((entry) => fs.existsSync(entry.absolutePath));
}

export function countLines(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return source ? source.split(/\r?\n/u).length : 0;
}

export function redactSensitiveValue(value, config) {
  let nextValue = String(value || '');
  const keys = Array.isArray(config?.redactionKeys) ? config.redactionKeys : [];

  for (const key of keys) {
    const regex = new RegExp(`(${escapeRegex(key)}\\s*[:=]\\s*)([^\\r\\n,]+)`, 'gi');
    nextValue = nextValue.replace(regex, '$1[REDACTED]');
  }

  nextValue = nextValue.replace(
    /\b(postgres(?:ql)?):\/\/([^:\s]+):([^@\s]+)@/gi,
    '$1://$2:[REDACTED]@',
  );

  return nextValue;
}

export function normalizeSnippet(value, maxLength = 220) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function summarizeCommandOutput(result, maxLength = 400) {
  const raw = normalizeSnippet(result.stderr || result.stdout || result.error || '', maxLength);
  return raw || '(no output)';
}

export function findFileLine(source, matcher) {
  const lines = String(source || '').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (matcher(lines[index], index)) {
      return index + 1;
    }
  }
  return 1;
}

export function resolveNodeModuleEntry(projectRoot, workspaceDir, candidates) {
  for (const candidate of candidates) {
    const workspaceCandidate = path.join(projectRoot, workspaceDir, candidate);
    if (fs.existsSync(workspaceCandidate)) return workspaceCandidate;

    const rootCandidate = path.join(projectRoot, candidate);
    if (fs.existsSync(rootCandidate)) return rootCandidate;
  }

  return null;
}

export function makeFinding(input) {
  return {
    severity: input.severity || 'info',
    category: input.category || 'general',
    ruleId: input.ruleId || 'unclassified',
    title: input.title || 'Untitled finding',
    description: input.description || '',
    file: input.file ? toPosix(input.file) : undefined,
    line: typeof input.line === 'number' ? input.line : undefined,
    evidence: input.evidence ? normalizeSnippet(input.evidence, 260) : undefined,
    remediation: input.remediation || undefined,
  };
}

export function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta !== 0) return severityDelta;
    return String(left.title || '').localeCompare(String(right.title || ''));
  });
}
