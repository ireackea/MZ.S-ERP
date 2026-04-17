import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectFiles,
  countLines,
  ensureDir,
  isExcludedRelativePath,
  loadAuditConfig,
  toPosix,
  writeJson,
} from './shared.mjs';

function toRelative(projectRoot, absolutePath) {
  return toPosix(path.relative(projectRoot, absolutePath));
}

export function collectInventory({ projectRoot, config }) {
  const allFiles = collectFiles(projectRoot, {
    excludedPatterns: config.excludedPaths,
  });

  const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.prisma', '.json', '.yml', '.yaml', '.md', '.ps1']);
  const sourceFiles = allFiles.filter((filePath) => sourceExtensions.has(path.extname(filePath).toLowerCase()));
  const frontendFiles = sourceFiles.filter((filePath) => toRelative(projectRoot, filePath).startsWith('frontend/'));
  const backendFiles = sourceFiles.filter((filePath) => toRelative(projectRoot, filePath).startsWith('backend/'));
  const tsxFiles = sourceFiles.filter((filePath) => path.extname(filePath).toLowerCase() === '.tsx');

  const giantComponents = tsxFiles
    .map((filePath) => ({
      path: toRelative(projectRoot, filePath),
      lines: countLines(filePath),
    }))
    .sort((left, right) => right.lines - left.lines)
    .slice(0, 15);

  const categories = {
    frontend: frontendFiles.length,
    backend: backendFiles.length,
    controllers: backendFiles.filter((filePath) => /controller\.ts$/i.test(filePath)).length,
    dtoAndValidation: backendFiles.filter((filePath) => /(dto|validation)/i.test(path.basename(filePath))).length,
    prisma: sourceFiles.filter((filePath) => /schema\.prisma$/i.test(filePath)).length,
    configs: sourceFiles.filter((filePath) => /(package(-lock)?\.json|docker-compose.*\.yml|tsconfig.*\.json|vite\.config\.ts|README\.md)$/i.test(path.basename(filePath))).length,
    tests: sourceFiles.filter((filePath) => /(\.test|\.spec)\.(ts|tsx|js|jsx)$/i.test(filePath)).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    totalFiles: allFiles.length,
    sourceFiles: sourceFiles.length,
    categories,
    giantComponents,
    topLevelEntries: fs
      .readdirSync(projectRoot, { withFileTypes: true })
      .filter((entry) => !isExcludedRelativePath(entry.name, config.excludedPaths))
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      })),
  };
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv);
  const projectRoot = path.resolve(String(args['project-root'] || process.cwd()));
  const configPath = path.resolve(String(args.config || path.join(projectRoot, 'scripts/audit/audit.config.json')));
  const outputDir = path.resolve(String(args['output-dir'] || path.join(projectRoot, 'audit-reports/surgical/manual')));
  const config = loadAuditConfig(configPath);
  const inventory = collectInventory({ projectRoot, config });

  ensureDir(outputDir);
  writeJson(path.join(outputDir, 'inventory.json'), inventory);
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
}
