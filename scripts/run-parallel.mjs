import { spawn } from 'node:child_process';

const rawSpecs = process.argv[2];

if (!rawSpecs) {
  console.error('Missing parallel command specification.');
  process.exit(1);
}

let specs;

try {
  specs = JSON.parse(rawSpecs);
} catch (error) {
  console.error('Invalid parallel command specification:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!Array.isArray(specs) || specs.length === 0) {
  console.error('Parallel command specification must be a non-empty array.');
  process.exit(1);
}

const children = [];
let settled = false;
let shutdownRequested = false;

const prefixAndWrite = (stream, label, chunk) => {
  const text = String(chunk ?? '');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (index === lines.length - 1 && line.length === 0) {
      return;
    }
    stream.write(`[${label}] ${line}\n`);
  });
};

const requestShutdown = (signal = 'SIGTERM') => {
  if (shutdownRequested) {
    return;
  }

  shutdownRequested = true;
  children.forEach((child) => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
};

const finalize = (exitCode) => {
  if (settled) {
    return;
  }

  settled = true;
  if (exitCode !== 0) {
    requestShutdown();
  }
  process.exit(exitCode);
};

process.on('SIGINT', () => {
  requestShutdown('SIGINT');
  finalize(130);
});

process.on('SIGTERM', () => {
  requestShutdown('SIGTERM');
  finalize(143);
});

let remaining = specs.length;

specs.forEach((spec, index) => {
  const label = String(spec?.label || `TASK_${index + 1}`).trim() || `TASK_${index + 1}`;
  const command = String(spec?.command || '').trim();

  if (!command) {
    console.error(`Missing command for ${label}.`);
    finalize(1);
    return;
  }

  const child = spawn(command, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  children.push(child);

  child.stdout.on('data', (chunk) => prefixAndWrite(process.stdout, label, chunk));
  child.stderr.on('data', (chunk) => prefixAndWrite(process.stderr, label, chunk));

  child.on('error', (error) => {
    console.error(`[${label}] Failed to start: ${error instanceof Error ? error.message : String(error)}`);
    finalize(1);
  });

  child.on('exit', (code, signal) => {
    remaining -= 1;

    if (signal) {
      console.error(`[${label}] stopped by signal ${signal}`);
      finalize(1);
      return;
    }

    if ((code ?? 0) !== 0) {
      console.error(`[${label}] exited with code ${code ?? 1}`);
      finalize(code ?? 1);
      return;
    }

    if (remaining === 0) {
      finalize(0);
    }
  });
});