/**
 * Which archives the log shows, and how many of each kind exist.
 *
 * ## Why this was extracted
 *
 * The filtering lived in the component as one `useMemo` against a single `activeType`
 * that *also* chose what the primary "create" button created and what it was labelled.
 * Three unrelated jobs, one variable, and no test anywhere — the component had no test file
 * at all, which is precisely why the coupling survived every review.
 *
 * Two consequences, both reported by the operator:
 *
 * - Choosing a filter **changed what the create button did and what it said**. Selecting
 *   "inventory" turned «إنشاء نسخة كاملة» into «إنشاء نسخة المخزون» — which was already a
 *   separate button. The full-backup button therefore existed only while the filter was set
 *   to "full".
 * - The default filter was `full`, which also showed `safety_snapshot` and **hid every
 *   `inventory` and `config` archive**. On a server holding mostly config archives the log
 *   looked nearly empty while the list endpoint was full.
 *
 * So the filter is its own concern here, with an `all` option, and it cannot reach anything
 * else.
 */

export type BackupKindName = 'full' | 'inventory' | 'config' | 'safety_snapshot';

/** `all` is first on purpose: the honest default shows everything. */
export type BackupFilter = 'all' | BackupKindName;

export type FilterableArchive = {
  type: string;
  createdAt: string;
};

export const BACKUP_FILTERS: ReadonlyArray<{ value: BackupFilter; label: string }> = [
  { value: 'all', label: 'الكل' },
  { value: 'full', label: 'كاملة' },
  { value: 'inventory', label: 'مخزون' },
  { value: 'config', label: 'إعدادات' },
  { value: 'safety_snapshot', label: 'لقطات أمان' },
];

/**
 * Newest first, then narrowed.
 *
 * `full` does **not** imply `safety_snapshot` any more. They are separate rows that
 * happened to share a filter, so counting them together made one kind's number lie about
 * the other — and hiding one behind the other's name meant choosing "full" changed what
 * the log contained without saying so.
 */
export function filterArchives<T extends FilterableArchive>(
  archives: readonly T[],
  filter: BackupFilter,
): T[] {
  const sorted = [...archives].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  if (filter === 'all') return sorted;
  return sorted.filter((entry) => entry.type === filter);
}

export type ArchiveCounts = Record<BackupKindName, number>;

/**
 * How many of each kind exist, so a filter says what it would show.
 *
 * Without this the operator cannot tell an empty filter from a wrong one, which is how a
 * hidden `config` archive reads as "the backup never happened".
 */
export function countArchives(archives: readonly FilterableArchive[]): ArchiveCounts {
  const counts: ArchiveCounts = {
    full: 0,
    inventory: 0,
    config: 0,
    safety_snapshot: 0,
  };
  for (const archive of archives) {
    if (archive.type in counts) {
      counts[archive.type as BackupKindName] += 1;
    }
  }
  return counts;
}

/** The number a filter would show, matching `filterArchives` exactly. */
export function countForFilter(
  archives: readonly FilterableArchive[],
  filter: BackupFilter,
): number {
  if (filter === 'all') return archives.length;
  return countArchives(archives)[filter as BackupKindName];
}