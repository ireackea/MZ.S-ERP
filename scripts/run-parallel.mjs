import { spawn, spawnSync } from 'node:child_process';
import { TextDecoder } from 'node:util';

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

const resolveOutputEncoding = () => {
  if (process.platform !== 'win32') {
    return 'utf-8';
  }

  const probe = spawnSync('chcp', [], {
    shell: true,
    encoding: 'utf8',
  });

  const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  const match = output.match(/\b(\d{3,5})\b/);

  if (!match) {
    return 'utf-8';
  }

  const codePage = match[1];

  if (codePage === '65001') {
    return 'utf-8';
  }

  if (codePage === '1200') {
    return 'utf-16le';
  }

  if (codePage === '1201') {
    return 'utf-16be';
  }

  return `windows-${codePage}`;
};

const normalizeSupportedEncoding = (encoding) => {
  const normalized = String(encoding || 'utf-8').toLowerCase();
  const explicit = String(process.env.RUN_PARALLEL_ENCODING || '').trim().toLowerCase();

  try {
    new TextDecoder(normalized, { fatal: false });
    return normalized;
  } catch {
    if (explicit.length > 0 && normalized !== 'utf-8') {
      console.warn(`[run-parallel] Unsupported output encoding "${encoding}", using utf-8 fallback.`);
    }
    return 'utf-8';
  }
};

const createDecoder = (encoding) => new TextDecoder(encoding, { fatal: false });

const findNextLineBreak = (text) => {
  const match = /(\r\n|\n|\r)/.exec(text);

  if (!match) {
    return null;
  }

  return {
    index: match.index,
    length: match[0].length,
  };
};

const createPrefixedWriter = (stream, label, decoder) => {
  let pending = '';

  const emitCompleteLines = () => {
    let lineBreak = findNextLineBreak(pending);

    while (lineBreak) {
      const line = pending.slice(0, lineBreak.index);
      stream.write(`[${label}] ${line}\n`);
      pending = pending.slice(lineBreak.index + lineBreak.length);
      lineBreak = findNextLineBreak(pending);
    }
  };

  return {
    push: (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''));
      pending += decoder.decode(bytes, { stream: true });
      emitCompleteLines();
    },
    flush: () => {
      pending += decoder.decode();
      emitCompleteLines();

      if (pending.length > 0) {
        stream.write(`[${label}] ${pending}\n`);
        pending = '';
      }
    },
  };
};

const children = [];
let settled = false;
let shutdownRequested = false;
const outputEncoding = normalizeSupportedEncoding(resolveOutputEncoding());

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

  const stdoutWriter = createPrefixedWriter(process.stdout, label, createDecoder(outputEncoding));
  const stderrWriter = createPrefixedWriter(process.stderr, label, createDecoder(outputEncoding));

  child.stdout.on('data', (chunk) => stdoutWriter.push(chunk));
  child.stderr.on('data', (chunk) => stderrWriter.push(chunk));
  child.stdout.on('end', () => stdoutWriter.flush());
  child.stderr.on('end', () => stderrWriter.flush());

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