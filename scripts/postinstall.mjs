import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const backendDir = join(rootDir, 'backend');
const schemaPath = join(backendDir, 'prisma', 'schema.prisma');

function resolvePrismaCli() {
  const candidates = [
    join(backendDir, 'node_modules', 'prisma', 'build', 'index.js'),
    join(rootDir, 'node_modules', 'prisma', 'build', 'index.js'),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

try {
  if (existsSync(schemaPath)) {
    console.log('Generating Prisma client...');
    const prismaCli = resolvePrismaCli();

    if (!prismaCli) {
      throw new Error('Prisma CLI could not be resolved from backend or root node_modules.');
    }

    execFileSync(process.execPath, [prismaCli, 'generate', '--config', 'prisma.config.ts'], {
      cwd: backendDir,
      stdio: 'inherit',
      env: { ...process.env },
    });
    console.log('Prisma client generated successfully!');
  } else {
    console.log('Prisma schema not found, skipping...');
  }
} catch (error) {
  console.error('Prisma generation failed, but continuing installation...');
  console.error('Run "npm run db:sync" manually after setup.');
  process.exit(0);
}
