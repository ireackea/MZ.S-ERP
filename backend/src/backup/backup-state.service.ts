import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BackupService } from './backup.service';
import { evaluateBackupHealth, type BackupHealth, type BackupVerdict } from './backup-health';
import { evaluateSchemaDrift, type DriftArchive, type SchemaDriftReport } from './schema-drift';
import { countVerifiedOffsiteCopies, offsiteDirectory } from './offsite-copy';

/**
 * B13 — one source of truth for whether the backups are all right.
 *
 * ## Why this exists as its own service
 *
 * Three screens needed the same answer and none of them had it:
 *
 * - the reset screen asked the manifest for the newest row and inferred health from
 *   one field;
 * - the dashboard showed a byte total, which is not a health claim;
 * - `App` showed nothing, so the one place an operator is guaranteed to look had no
 *   warning at all.
 *
 * When three places answer the same question independently they drift, and the drift
 * is invisible: there is no failure when they disagree, only a product that tells the
 * operator two different things about the same archive on two different screens.
 *
 * So this is the only place the question is answered. It gathers facts and delegates
 * every decision to `evaluateBackupHealth`, which is pure. A caller that wants a
 * different answer has to change this file, which is the point — one place to be
 * wrong, rather than three.
 *
 * ## Caching
 *
 * The result is memoised for a short window. Health is a question about the state of
 * the world, and `App` asks on every render; re-reading the manifest and re-checking
 * integrity on each one would be a cost with no freshness gain. The window is short
 * enough that a schedule which has just failed still shows up, and long enough that a
 * page full of components asking at once costs one read.
 *
 * `refresh: true` bypasses it, for the audit case: an operator who wants to know
 * *right now* must be able to ask, and a green badge that cannot be re-checked on
 * demand is a claim rather than a measurement.
 */

const HEALTH_CACHE_TTL_MS = 30_000;

@Injectable()
export class BackupStateService implements OnModuleInit {
  private readonly logger = new Logger(BackupStateService.name);
  private cached: { at: number; health: BackupHealth } | null = null;
  private pending: Promise<BackupHealth> | null = null;

  constructor(private readonly backupService: BackupService) {}

  /**
   * B14 — read the drift at boot, when there is still time to take another backup.
   *
   * The check itself is not new; it ran on the restore path, which means it was only ever
   * reached at the moment its answer was useless. Moving it here costs one manifest read
   * at startup and buys the operator a warning while a schedule still runs.
   *
   * Deliberately does not block boot. If the archives cannot be restored against this
   * image then this image is what is needed to *produce* restorable ones, and refusing to
   * start would leave a down server holding the same stale backups.
   */
  async onModuleInit(): Promise<void> {
    try {
      const drift = await this.readSchemaDrift();
      if (drift.severity === 'error') {
        this.logger.error(
          `Backup schema drift: ${drift.message} This is reported, not enforced — the server must run so it can take fresh backups.`,
        );
      } else if (drift.severity === 'warning') {
        this.logger.warn(`Backup schema drift: ${drift.message}`);
      }
    } catch (error) {
      // A startup diagnostic must never be the reason a server does not start.
      this.logger.warn(
        `Backup schema drift could not be checked at boot: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Reads the migration list each archive recorded, for the newest few.
   *
   * Only the newest handful: opening an archive means decrypting it, and at boot that is
   * the wrong place to spend a large allocation on a diagnostic. An older archive's
   * verdict is not what decides whether the operator can recover anyway.
   */
  private async readSchemaDrift(limit = 5): Promise<SchemaDriftReport> {
    const archives = await this.backupService.inspectArchiveMigrations(limit);
    return evaluateSchemaDrift({
      archives: archives as DriftArchive[],
      expected: this.backupService.currentMigrationNames(),
    });
  }

  async getHealth(options: { verify?: boolean; refresh?: boolean } = {}): Promise<BackupHealth> {
    if (options.refresh) this.cached = null;

    const fresh = this.cached && Date.now() - this.cached.at < HEALTH_CACHE_TTL_MS;
    if (fresh && !options.verify) return this.cached!.health;

    // One read in flight at a time. `App` renders many components, and without this
    // each of them would start its own manifest read and integrity check at the same
    // moment.
    if (this.pending) return this.pending;

    this.pending = this.gather(options)
      .then((health) => {
        this.cached = { at: Date.now(), health };
        return health;
      })
      .catch((error) => {
        // A health check that throws is a health check that shows nothing, which is
        // the state this whole service exists to end. A stale answer with the failure
        // recorded is strictly better than a blank screen.
        this.logger.error('Backup health could not be read.', error instanceof Error ? error : new Error(String(error)));
        return this.fallbackHealth();
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }

  private async gather(options: { verify?: boolean }): Promise<BackupHealth> {
    const offsiteConfigured = offsiteDirectory() !== null;
    const [archives, schedule, drift] = await Promise.all([
      this.backupService.listBackups(undefined, { verify: options.verify === true }),
      this.backupService.getPublicSchedule(),
      // A diagnostic must never be the reason health fails to report, so it degrades to
      // "could not be checked" rather than taking the whole payload down with it.
      this.readSchemaDrift().catch((error) => {
        this.logger.warn(`schema drift check failed: ${error instanceof Error ? error.message : String(error)}`);
        return {
          judged: 0,
          unknown: 0,
          drifting: 0,
          newest: null,
          newestBlocked: false,
          severity: 'warning' as const,
          message: 'تعذّر فحص انحراف مخطط النسخ الاحتياطية. لا تفترض أنه سليم.',
        };
      }),
    ]);

    return {
      ...evaluateBackupHealth({
      archives: archives.map((entry) => ({
        id: entry.id,
        type: entry.type,
        createdAt: entry.createdAt,
        sizeBytes: entry.sizeBytes,
        integrity: entry.integrityLabel ?? entry.integrity,
        complete: entry.complete,
      })),
      schedule: schedule
        ? {
            enabled: schedule.enabled,
            lastRunAt: schedule.lastRunAt,
            lastRunKey: schedule.lastRunKey,
            frequency: schedule.frequency,
            hour: schedule.hour,
            minute: schedule.minute,
          }
        : null,
      // B5 — the 3-2-1 answer is honest about what this deployment actually has.
      // Every archive is inside one directory on one machine, so the count is one
      // location and zero off-site. Reporting the file count as if it were three
      // copies in three places is the false comfort this number exists to remove.
      //
      // B19 — `offSiteCopies` is now measured. It counts archives whose off-host copy was
      // read back and matched, not whether a destination is configured: a setting that is
      // present and a copy that arrived are different claims, and only the second one is
      // protection. A device that was unplugged once must not read as off-site coverage.
      storageLocations: 1 + (offsiteConfigured ? 1 : 0),
      offSiteCopies: countVerifiedOffsiteCopies(
        archives.map((entry) => ({ offsite: (entry as any).offsite ?? null })),
      ),
    }),
      // B14 — attached rather than folded into `verdict`, so an archive that is intact
      // and readable is not silently downgraded to "unhealthy" because a *different*
      // image would be needed to restore it. The two questions stay separate, and the
      // UI can show both.
      schemaDrift: drift,
    };
  }

  private fallbackHealth(): BackupHealth {
    return {
      verdict: 'unhealthy' as BackupVerdict,
      summary: 'تعذّر قراءة حالة النسخ الاحتياطية. لا تفترض أنها سليمة.',
      lastBackup: null,
      archiveCount: 0,
      restorableCount: 0,
      threeTwoOne: { copies: 0, storageLocations: 0, offSite: 0, satisfied: false, note: 'غير معروف.' },
      schedule: null,
      problems: [
        {
          code: 'BACKUP_HEALTH_UNREADABLE',
          severity: 'error',
          message: 'تعذّر قراءة حالة النسخ الاحتياطية. اعرضها كغير معروفة لا كسليمة.',
        },
      ],
    };
  }
}
