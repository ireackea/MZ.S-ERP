import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * Phase 1 + 2, checked against the bundle the browser actually downloads.
 *
 * The unit tests and the guards cover the decisions and the source. Neither proves that
 * the shipped JavaScript contains them — and that gap is exactly how «لا أستطيع استعادة
 * أي نسخة» survived this long: correct code in the repository, and the earlier incident
 * where the button was missing from the running page while the server was fine.
 *
 * So this asks the built assets inside the running frontend container. The strings are
 * grepped *there* rather than pulled into Node, because the bundle is over 3 MB and
 * `execFileSync` caps its buffer at 1 MB — a limit that fails as an opaque error rather
 * than as "your bundle is too big to read".
 *
 * It is deliberately not a rendering test. It does not care where a string sits in the
 * markup; it cares that the text a user would read is present and that the misleading
 * text is not.
 */

const ASSET_GLOB = '/usr/share/nginx/html/assets/*.js';

const inFrontend = (command: string, timeout = 120_000) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'frontend', 'sh', '-lc', command], {
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });

/** The asset files whose contents contain `needle`. */
const assetsContaining = (needle: string): string[] => {
  // `-l` lists filenames only, so the output stays small however large the bundle is.
  // Single quotes protect the Arabic text; nothing here may be interpolated by a shell.
  try {
    return inFrontend(`grep -l -F -- '${needle.replace(/'/g, "")}' ${ASSET_GLOB}`)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // `grep` exits non-zero when there is no match, which is an answer, not a failure.
    return [];
  }
};

const served = (needle: string) => assetsContaining(needle).length > 0;

const hasContainers = (() => {
  try {
    const out = execFileSync('docker', ['compose', 'ps', '--format', '{{.Service}} {{.State}}'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    return /frontend\s+running/.test(out);
  } catch {
    return false;
  }
})();

const describeLive = hasContainers ? describe : describe.skip;

describeLive('the served bundle, not merely the repository', () => {
  it('carries three create buttons, each naming its own type', () => {
    // The reported symptom was that selecting a filter renamed the primary button. With
    // the shared variable gone, each button names its own kind and nothing about it
    // depends on a selection elsewhere on the page.
    expect(served('إنشاء نسخة كاملة')).toBe(true);
    expect(served('إنشاء نسخة المخزون')).toBe(true);
    expect(served('إنشاء نسخة الإعدادات')).toBe(true);
  }, 120_000);

  it('has no computed create-button label left to change', () => {
    expect(served('createActionLabel')).toBe(false);
    expect(served('activeType')).toBe(false);
  }, 120_000);

  it('offers "all" as a filter, and labels safety snapshots on their own', () => {
    // The default used to be `full`, which also showed `safety_snapshot` and hid every
    // config and inventory archive — so a server holding mostly config archives showed a
    // log that read as empty.
    expect(served('الكل')).toBe(true);
    expect(served('لقطات أمان')).toBe(true);
  }, 120_000);

  it('states there is no off-host copy, and the option list is gone', () => {
    // The checkboxes were saved, validated and echoed back by the service while nothing
    // ever wrote to a USB device or a network share.
    //
    // The negative assertion is on `storageTargetLabel` — the map that rendered those
    // buttons — and not on the words themselves: the replacement notice deliberately names
    // both options to tell the operator they were never real, so grepping for the phrase
    // would flag the text that fixes the problem.
    expect(served('لا توجد نسخة خارج المضيف')).toBe(true);
    expect(served('storageTargetLabel')).toBe(false);
    expect(served("'local', 'usb', 'drive'")).toBe(false);
  }, 120_000);

  it('does not promise a restore PIN that is not configured', () => {
    // The fixed sentence claimed a PIN in every state, including the default one where no
    // PIN exists and none is demanded — which is why it demanded a code that could not
    // exist.
    expect(served('الاستعادة تتطلب رمز PIN صالح')).toBe(false);
    expect(served('لا يوجد رمز استعادة')).toBe(true);
  }, 120_000);
});