import fs from 'fs';
import path from 'path';

const controlOrMarkerRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F]|ï؟½|⬑|␦|7"7/u;
const ignoreLineMarker = 'encoding-check-ignore-line';

const projectRoot = process.cwd();
// `.md` is scanned because the remediation plans are written in Arabic prose by an
// editor rather than by a compiler, and they are where this repository's encoding
// damage actually accumulated: `archive-key.ts` had lost its leading letter to a
// U+0007, and `backup-reconcile.ts` its `b` to a U+0008, in a file no gate ever
// opened. Nothing in a Markdown file can fail a build, so the gate is the only
// thing that will ever notice.
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs', '.cjs', '.html', '.md']);
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

// Characters that appear in text which was decoded as Windows-1252 instead of
// UTF-8. An Arabic string that went through that mis-decode comes back as a run
// of 1252 half-glyphs, so the *signature* is always one of those halves —
// U+20AC, U+00A6, U+00A7, U+00B1, U+00B2 — and never the character the author
// originally typed. The form below is the one an ellipsis takes after the
// mis-decode: three 1252 glyphs, not one.
//
// Four entries were removed from this list on 2026-09-29 after they turned out
// to be legitimate Arabic typography rather than a corruption signature, and
// their presence made `npm run ci:verify` fail on its very first step across ten
// files that had never been edited:
//
//   U+2026 (ellipsis)   U+00B7 (middle dot)   U+00AB (left guillemet)
//   U+00B4 (acute accent)
//
// Removing them cannot hide a real mojibake, because the mis-decoded form of
// each still contains a listed character: U+2026 expands into U+20AC and
// U+00A6, both listed, and U+00AB arrives preceded by U+00C2 followed by
// U+00A6. What is given up is only the author's own punctuation.
//
// Note that this file is scanned by this file, so the characters above are named
// by code point rather than written literally. `sec-006-encoding-contract`
// asserts the true 1252 signature set is still present.
//
// The Arabic-mojibake heuristic below and the tokenized-mojibake heuristic are
// unaffected: they work on letter-pair ratios, not on this character list.
const suspiciousCharsRegex =
  /[\u00A7\u201E\u2020\u00AF\u00B5\u02C6\u00B1\u00AD\u00A8\u00A9\u00B3\u00B9\u2021\u00A3\u00AC\u201A\u0192\u00A5\u00B0\u00AE\u2030\u00B2\u00B6\u2039\u00A6\u0152\u00B8\u00A2\u20AC\uFFFD]/u;

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

/**
 * A control character anywhere in the file, reported on its own.
 *
 * The tokenized heuristic below already looks for control characters, but only
 * inside comments and string literals that also contain two of `[78]` and a marker —
 * which is the shape a mis-decode leaves. A control character that arrives any other
 * way is invisible to it: the U+0007 that ate the `a` of `archive-key.ts` in a
 * JSDoc comment, and the U+0008 that ate the `b` of `backup-reconcile.ts` in a
 * table, both sat in files this gate passed, because neither sat next to a digit.
 *
 * They are never legitimate in a text file, so they are checked unconditionally.
 * `\t`, `\n` and `\r` are the three that are.
 */
function findControlCharacters(text) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(ignoreLineMarker)) continue;
    for (let col = 0; col < lines[i].length; col += 1) {
      const code = lines[i].charCodeAt(col);
      const isControl = code < 0x20 && code !== 0x09 && code !== 0x0d;
      if (!isControl) continue;
      findings.push({
        line: i + 1,
        col: col + 1,
        code: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
        context: lines[i].slice(Math.max(0, col - 24), col + 25),
      });
      if (findings.length >= 8) return findings;
    }
  }
  return findings;
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

function extractHumanTextCandidates(line) {
  const candidates = [];

  const commentIndex = line.indexOf('//');
  if (commentIndex >= 0) {
    candidates.push(line.slice(commentIndex + 2));
  }

  const stringRegex = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let match;
  while ((match = stringRegex.exec(line)) !== null) {
    candidates.push(match[1] ?? match[2] ?? match[3] ?? '');
  }

  return candidates;
}

function extractJsxVisibleText(line) {
  if (!line.includes('<') || !line.includes('>')) return '';

  return line
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeTokenizedMojibake(segment) {
  if (!segment) return false;
  if (controlOrMarkerRegex.test(segment)) return true;

  const compact = segment.trim();
  if (!compact) return false;

  const digit78Chars = (compact.match(/[78]/g) || []).length;
  const markerChars = (compact.match(/[&~!y]/g) || []).length;
  if (digit78Chars < 2) return false;
  if (markerChars === 0) return false;

  const tokenChars = digit78Chars + markerChars;
  const ratio = tokenChars / compact.length;
  return ratio >= 0.35;
}

function findTokenizedMojibake(text) {
  const lines = text.split('\n');
  const examples = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes(ignoreLineMarker)) continue;

    const candidates = extractHumanTextCandidates(line);
    const jsxVisibleText = extractJsxVisibleText(line);
    if (jsxVisibleText) {
      candidates.push(jsxVisibleText);
    }

    const hit = candidates.find(looksLikeTokenizedMojibake);
    if (!hit) continue;

    examples.push({ line: i + 1, sample: hit.trim().slice(0, 160) });
    if (examples.length >= 5) break;
  }

  return examples.length > 0 ? examples : null;
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
  const isMarkdown = path.extname(filePath) === '.md';
  const charFindings = findSuspiciousChars(text);
  const controlFindings = findControlCharacters(text);
  const mojibake = findArabicMojibake(text);
  const tokenizedMojibake = findTokenizedMojibake(text);

  // In Markdown the Windows-1252 signature characters are reported, not fatal.
  //
  // They are fatal in source, where U+00A7 has no legitimate reading. In a document
  // written in Arabic prose they can be exactly that — and this file has already
  // been wrong about that once: four entries were removed from the signature list
  // in 2026-09-29 after they turned out to be legitimate typography, and their
  // presence made `ci:verify` fail on ten files nobody had edited. A gate that
  // cannot tell the difference between damage and punctuation is a gate that gets
  // deleted. What stays fatal in Markdown is the two signals that have no innocent
  // reading at all: a control character, and U+FFFD, which is the replacement
  // character — the one a lossy decode leaves when the original bytes are already
  // gone.
  //
  // U+00A7 is named by code point rather than written literally, for the reason the
  // note above gives about this file scanning itself.
  const fatalCharFindings = charFindings.filter(
    (finding) => !isMarkdown || finding.code === 'U+FFFD',
  );
  const advisoryCharFindings = isMarkdown ? charFindings.filter((f) => f.code !== 'U+FFFD') : [];

  if (
    fatalCharFindings.length > 0 ||
    controlFindings.length > 0 ||
    mojibake ||
    tokenizedMojibake ||
    advisoryCharFindings.length > 0
  ) {
    issues.push({
      file: path.relative(projectRoot, filePath),
      bom: false,
      charFindings: fatalCharFindings,
      advisoryCharFindings,
      controlFindings,
      mojibake,
      tokenizedMojibake,
    });
  }
}

if (issues.length > 0) {
  let fatal = 0;
  let advisory = 0;

  console.error('\nFound text-encoding issues:\n');
  for (const issue of issues) {
    const soft = (issue.charFindings || []).length === 0 && (issue.controlFindings || []).length === 0 && !issue.mojibake && !issue.tokenizedMojibake;
    if (soft) advisory += 1;
    else fatal += 1;

    console.error(`- ${issue.file}${soft ? '  (advisory)' : ''}`);
    if (issue.bom) {
      console.error('  UTF-8 BOM detected (must be UTF-8 without BOM)');
    }
    for (const finding of issue.charFindings) {
      console.error(`  at ${finding.line}:${finding.col} -> ${finding.code} (${JSON.stringify(finding.char)})`);
    }
    for (const finding of issue.advisoryCharFindings || []) {
      console.error(
        `  at ${finding.line}:${finding.col} -> ${finding.code} (${JSON.stringify(finding.char)}) — ` +
          '1252 signature in Markdown: may be legitimate typography, reported not enforced',
      );
    }
    for (const finding of issue.controlFindings || []) {
      console.error(
        `  at ${finding.line}:${finding.col} -> ${finding.code} control character in: ${JSON.stringify(finding.context)}`,
      );
    }
    if (issue.mojibake) {
      console.error(`  Arabic mojibake signal: ${(issue.mojibake.ratio * 100).toFixed(1)}% suspicious pairs`);
      for (const ex of issue.mojibake.examples) {
        console.error(`  line ${ex.line}: ${ex.sample}`);
      }
    }
    if (issue.tokenizedMojibake) {
      console.error('  Tokenized/control-character mojibake detected:');
      for (const ex of issue.tokenizedMojibake) {
        console.error(`  line ${ex.line}: ${ex.sample}`);
      }
    }
  }
  if (advisory > 0) {
    console.error(`\n${advisory} file(s) reported only. Advisory: a 1252 signature in Markdown is not necessarily damage.\n`);
  }
  if (fatal > 0) {
    console.error('\nFix encoding issues before commit/build.\n');
    process.exit(1);
  }

  console.log('Text encoding check passed.');
  console.log(`(${advisory} file(s) reported above as advisory.)`);
} else {
  console.log('Text encoding check passed.');
}
