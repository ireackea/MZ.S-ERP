import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs', '.cjs']);
const ignoredDirs = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.vs',
  '.vscode',
  '.continue',
  'coverage',
  'tmp',
  'temp',
  '_ARCHIVE_',
]);
const ignoredFileNames = new Set(['package-lock.json']);

const suspiciousCharsRegex =
  /[\u00A7\u201E\u2020\u00AF\u2026\u00B5\u02C6\u00B1\u00AD\u00A8\u00A9\u00B3\u00B9\u2021\u00A3\u00AC\u201A\u0192\u00A5\u00B0\u00AE\u00B7\u2030\u00B2\u00B6\u2039\u00A6\u0152\u00B8\u00A2\u00AB\u00B4\u20AC\uFFFD]/u;

function collectFiles(entryPath, out = []) {
  const stat = fs.statSync(entryPath);
  if (stat.isFile()) {
    if (extensions.has(path.extname(entryPath)) && !ignoredFileNames.has(path.basename(entryPath))) {
      out.push(entryPath);
    }
    return out;
  }

  const children = fs.readdirSync(entryPath, { withFileTypes: true });
  for (const child of children) {
    if (ignoredDirs.has(child.name)) continue;
    const childPath = path.join(entryPath, child.name);
    if (child.isDirectory()) {
      collectFiles(childPath, out);
    } else if (extensions.has(path.extname(child.name)) && !ignoredFileNames.has(child.name)) {
      out.push(childPath);
    }
  }
  return out;
}

function findSuspiciousChars(text) {
  const findings = [];
  let line = 1;
  let col = 1;

  for (const ch of text) {
    if (ch === '\n') {
      line += 1;
      col = 1;
      continue;
    }
    if (suspiciousCharsRegex.test(ch)) {
      findings.push({
        line,
        col,
        code: `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
        char: ch,
      });
      if (findings.length >= 8) break;
    }
    col += 1;
  }

  return findings;
}

function findArabicMojibake(text) {
  const arabicChars = text.match(/[\u0600-\u06FF]/g) || [];
  if (arabicChars.length < 30) return null;

  const suspiciousPairs = text.match(/[\u0637\u0638][\u0600-\u06FF]/g) || [];
  const ratio = suspiciousPairs.length / arabicChars.length;
  if (ratio < 0.14) return null;

  const lines = text.split('\n');
  const examples = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineArabic = line.match(/[\u0600-\u06FF]/g) || [];
    if (lineArabic.length < 10) continue;
    const linePairs = line.match(/[\u0637\u0638][\u0600-\u06FF]/g) || [];
    if (linePairs.length / lineArabic.length >= 0.2) {
      examples.push({ line: i + 1, sample: line.trim().slice(0, 120) });
      if (examples.length >= 3) break;
    }
  }

  return { ratio, examples };
}

const files = collectFiles(projectRoot);
const issues = [];

for (const filePath of files) {
  const raw = fs.readFileSync(filePath);

  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    issues.push({
      file: path.relative(projectRoot, filePath),
      bom: true,
      charFindings: [],
      mojibake: null,
    });
    continue;
  }

  const text = raw.toString('utf8');
  const charFindings = findSuspiciousChars(text);
  const mojibake = findArabicMojibake(text);
  if (charFindings.length > 0 || mojibake) {
    issues.push({
      file: path.relative(projectRoot, filePath),
      bom: false,
      charFindings,
      mojibake,
    });
  }
}

if (issues.length > 0) {
  console.error('\nFound text-encoding issues:\n');
  for (const issue of issues) {
    console.error(`- ${issue.file}`);
    if (issue.bom) {
      console.error('  UTF-8 BOM detected (must be UTF-8 without BOM)');
    }
    for (const finding of issue.charFindings) {
      console.error(`  at ${finding.line}:${finding.col} -> ${finding.code} (${JSON.stringify(finding.char)})`);
    }
    if (issue.mojibake) {
      console.error(`  Arabic mojibake signal: ${(issue.mojibake.ratio * 100).toFixed(1)}% suspicious pairs`);
      for (const ex of issue.mojibake.examples) {
        console.error(`  line ${ex.line}: ${ex.sample}`);
      }
    }
  }
  console.error('\nFix encoding issues before commit/build.\n');
  process.exit(1);
}

console.log('Text encoding check passed.');
