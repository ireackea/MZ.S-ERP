import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The save button reported success for a write that went nowhere.
 *
 * `save()` called two store setters and a toast. The store holds `reportConfig`
 * in memory and initialises it to `[]`, and nothing hydrates it — so the settings
 * tab seeded its own list from the catalogue, let the operator tick columns, wrote
 * them to a store that reset to `[]` on the next reload, and said "saved
 * successfully". `getReportConfig()` and `saveReportConfig()` in storage.ts existed
 * for exactly this and had no call sites.
 *
 * The worst of it is downstream: `Reports.tsx` and `OpeningBalancePage.tsx` read
 * the column list from the store, so after a reload they held `[]` and
 * `Reports.tsx` sent `columns: []` — which the server refuses. The panel was not
 * merely not persisting; the thing it was supposed to configure was already broken
 * and the success message covered it.
 *
 * So the assertion is not "a toast fired" but "the value is there after the
 * component is gone", which is the only version of these assertions that can fail.
 */
const mocks = vi.hoisted(() => ({ hasPermission: vi.fn() }));

vi.mock('@hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('@services/toastService', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import PrintingTemplates from '../PrintingTemplates';
import { useInventoryStore } from '../../../../store/useInventoryStore';
import { getOpeningBalanceReportConfig, getReportConfig } from '@services/storage';

/**
 * Wired the way `App.tsx` wires it: the props carry the store's current values and
 * the callbacks are the store setters. Mocking the callbacks tested the toast and
 * nothing else, which is how the defect this file exists for passed a green suite
 * for as long as it did.
 */
const setup = () => {
  const state = useInventoryStore.getState();
  return render(
    <PrintingTemplates
      reportConfig={state.reportConfig}
      onUpdateReportConfig={(config) => useInventoryStore.getState().setReportConfig(config)}
      openingBalanceReportConfig={state.openingBalanceReportConfig}
      onUpdateOpeningBalanceReportConfig={(config) =>
        useInventoryStore.getState().setOpeningBalanceReportConfig(config)
      }
    />,
  );
};

/**
 * Node defines a `localStorage` global that is present but not usable — accessing
 * it warns and reading returns null. `storage.ts` guards on
 * `typeof localStorage !== 'undefined'`, which passes, so every read falls through
 * to the fallback and every write is dropped. Without this stub the assertions
 * below would pass for the wrong reason on any environment, which is a worse
 * outcome than failing.
 */
const installLocalStorage = () => {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  installLocalStorage();
  window.localStorage.clear();
  // The store is module state and outlives a test, so a selection saved by one test
  // would otherwise seed the next and make its assertions order-dependent.
  useInventoryStore.setState({ reportConfig: [], openingBalanceReportConfig: [] });
});

describe('the print-template save persists', () => {
  it('writes an unticked column to storage, not only to the store', () => {
    setup();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /حفظ القوالب/ }));

    expect(getReportConfig().find((column) => column.key === 'date')?.isVisible).toBe(false);
  });

  it('writes the opening-balance list to its own key, not the stock-card one', () => {
    setup();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /حفظ القوالب/ }));

    // Asserted against the stored key rather than through the getter, because the
    // getter answers from the catalogue when nothing was written — which is exactly
    // the failure this test exists for, and reading through it makes the assertion
    // vacuously true.
    const opening = window.localStorage.getItem('feed_factory_opening_balance_report_config');
    expect(opening).toBeTruthy();
    expect(JSON.parse(opening as string).find((column: { key: string }) => column.key === 'item'))
      .toEqual({ key: 'item', label: 'الصنف', isVisible: true });

    const stockCard = window.localStorage.getItem('feed_factory_report_config');
    expect(stockCard).toBeTruthy();
    expect(JSON.parse(stockCard as string).find((column: { key: string }) => column.key === 'date')?.isVisible)
      .toBe(false);
  });

  it('shows what a previous session saved, not the bare catalogue', () => {
    // The store hydrates once, when the module is first imported, which happens
    // before `beforeEach` installs the stub. Re-hydrating here is what boot does,
    // in the order boot does it, so this asserts the read path rather than import
    // order.
    window.localStorage.setItem(
      'feed_factory_report_config',
      JSON.stringify([{ key: 'date', label: 'التاريخ', isVisible: false }]),
    );
    useInventoryStore.setState({ reportConfig: getReportConfig() });

    setup();

    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  });

  /**
   * Gate 4.6 — the tab is visible on `settings.view.general` and the panel used to
   * gate on `settings.update.system`, so a holder of exactly the tab's permission
   * opened a tab that could only ever show them a red wall saying no.
   *
   * Every other panel in this section renders itself read-only for a viewer, which
   * is what this now does. The assertion is that the controls are present and
   * inert, not that a permission banner appeared.
   */
  it('renders read-only for a viewer instead of a denial wall', () => {
    mocks.hasPermission.mockImplementation((key: string) => key === 'settings.view.general');

    setup();

    const box = screen.getAllByRole('checkbox')[0];
    expect(box).toBeInTheDocument();
    expect(box).toBeDisabled();
    expect(screen.queryByText(/لا تملك صلاحية تعديل قوالب الطباعة/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /حفظ القوالب/ })).toBeDisabled();
  });
});
