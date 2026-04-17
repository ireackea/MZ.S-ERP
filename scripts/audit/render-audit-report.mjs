import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, severityWeights, sortFindings, writeJson, writeText } from './shared.mjs';

export function calculateScore({ findings, runtimeRequired, runtimeCompleted }) {
  let score = 100;
  for (const finding of findings) {
    score -= severityWeights[finding.severity] || 0;
  }
  if (runtimeRequired && !runtimeCompleted) {
    score -= 20;
  }
  return Math.max(0, score);
}

function buildCounts(findings) {
  return findings.reduce((accumulator, finding) => {
    accumulator[finding.severity] = (accumulator[finding.severity] || 0) + 1;
    return accumulator;
  }, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
}

function decideVerdict({ counts, runtimeRequired, runtimeCompleted, mode }) {
  if (runtimeRequired && !runtimeCompleted) {
    return {
      decision: 'RED',
      exitCode: 2,
      summary: 'Runtime audit was required but did not complete.',
    };
  }

  if (counts.critical > 0) {
    return {
      decision: 'RED',
      exitCode: 2,
      summary: 'Critical findings were detected.',
    };
  }

  if (counts.high > 0) {
    return {
      decision: 'YELLOW',
      exitCode: 1,
      summary: 'High-severity findings require remediation before trust is restored.',
    };
  }

  if (mode === 'static') {
    return {
      decision: 'YELLOW',
      exitCode: 0,
      summary: 'Static-only audit completed. Runtime certification is intentionally incomplete.',
    };
  }

  return {
    decision: counts.medium > 0 || counts.low > 0 ? 'YELLOW' : 'GREEN',
    exitCode: 0,
    summary: counts.medium > 0 || counts.low > 0
      ? 'Audit completed without critical/high blockers, but residual findings remain.'
      : 'Audit completed without recorded blockers.',
  };
}

function renderMarkdown({ mode, inventory, findings, counts, score, verdict, staticReport, runtimeReport }) {
  const topFindings = findings.slice(0, 20);
  const inventorySection = inventory
    ? [
        '## Inventory',
        '',
        '```json',
        JSON.stringify(inventory, null, 2),
        '```',
        '',
      ].join('\n')
    : '';

  const runtimeSection = runtimeReport
    ? [
        '## Runtime Checks',
        '',
        ...(runtimeReport.checks?.length
          ? runtimeReport.checks.map((check) => `- ${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.status ? ` (status=${check.status})` : ''}`)
          : ['- No runtime probes were executed.']),
        '',
      ].join('\n')
    : [
        '## Runtime Checks',
        '',
        mode === 'static'
          ? '- Skipped intentionally via `-StaticOnly`.'
          : '- Runtime report unavailable.',
        '',
      ].join('\n');

  const findingsSection = topFindings.length
    ? [
        '## Top Findings',
        '',
        ...topFindings.map((finding, index) => {
          const location = finding.file ? ` | ${finding.file}${finding.line ? `:${finding.line}` : ''}` : '';
          const evidence = finding.evidence ? ` | evidence: ${finding.evidence}` : '';
          return `${index + 1}. [${finding.severity.toUpperCase()}] ${finding.title}${location}${evidence}`;
        }),
        '',
      ].join('\n')
    : '## Top Findings\n\n- No findings were recorded.\n';

  return [
    '# FINAL_SURGICAL_AUDIT_REPORT',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Mode: ${mode}`,
    `- Decision: ${verdict.decision}`,
    `- Integrity Score: ${score}%`,
    `- Summary: ${verdict.summary}`,
    '',
    '## Severity Counts',
    '',
    `- Critical: ${counts.critical}`,
    `- High: ${counts.high}`,
    `- Medium: ${counts.medium}`,
    `- Low: ${counts.low}`,
    `- Info: ${counts.info}`,
    '',
    inventorySection,
    runtimeSection,
    findingsSection,
    '## Stage Status',
    '',
    `- Static findings: ${staticReport?.findings?.length || 0}`,
    `- Runtime findings: ${runtimeReport?.findings?.length || 0}`,
    '',
  ].join('\n');
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

export function renderAuditReport({ outputDir, mode }) {
  const inventory = readJson(path.join(outputDir, 'inventory.json'), null);
  const staticReport = readJson(path.join(outputDir, 'static-report.json'), null);
  const runtimeReport = readJson(path.join(outputDir, 'runtime-report.json'), null);
  const findings = sortFindings([
    ...(staticReport?.findings || []),
    ...(runtimeReport?.findings || []),
  ]);
  const counts = buildCounts(findings);
  const runtimeRequired = mode !== 'static';
  const runtimeCompleted = mode === 'static' ? false : Boolean(runtimeReport);
  const score = calculateScore({ findings, runtimeRequired, runtimeCompleted });
  const verdict = decideVerdict({ counts, runtimeRequired, runtimeCompleted, mode });

  const combined = {
    generatedAt: new Date().toISOString(),
    mode,
    score,
    counts,
    verdict,
    inventory,
    static: staticReport,
    runtime: runtimeReport,
    findings,
    exitCode: verdict.exitCode,
  };

  writeJson(path.join(outputDir, 'final-report.json'), combined);
  writeText(path.join(outputDir, 'FINAL_SURGICAL_AUDIT_REPORT.md'), renderMarkdown({
    mode,
    inventory,
    findings,
    counts,
    score,
    verdict,
    staticReport,
    runtimeReport,
  }));

  return combined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv);
  const outputDir = path.resolve(String(args['output-dir']));
  const mode = String(args.mode || 'full');
  const report = renderAuditReport({ outputDir, mode });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
