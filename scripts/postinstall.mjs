import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const rootDir = join(__dirname, '..');
const backendDir = join(rootDir, 'backend');
const schemaPath = join(backendDir, 'prisma', 'schema.prisma');

try {
  if (existsSync(schemaPath)) {
    console.log('Generating Prisma client...');
    // Use local prisma from backend node_modules
    const prismaPath = join(backendDir, 'node_modules', '.bin', 'prisma');
    execSync(`"${prismaPath}" generate`, {
      cwd: backendDir,
      stdio: 'inherit',
      env: { ...process.env }
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
