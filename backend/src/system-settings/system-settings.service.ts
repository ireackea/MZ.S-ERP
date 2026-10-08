import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import type { UpdateSystemSettingsDto } from './system-settings.controller';

/**
 * The single reader and writer of company settings.
 *
 * Gate 2.1. Before this, the settings screen wrote to a client-side store and the
 * value on screen was the value an administrator believed they had set. Every
 * consumer — the stock card, the statement, the daily-operations print, the
 * stocktake header — read that store. So one reload undid the change on a value
 * printed on every document the system produces, and nothing reported it.
 *
 * Two rules keep it from drifting back:
 *
 * 1. A key that is not in the catalogue is refused. Otherwise the table becomes a
 *    second, unvalidated settings surface that no screen renders and no report
 *    reads — a place values go to be lost.
 * 2. The declared type is enforced on write, because a TEXT column cannot and
 *    `defaultUnloadingDuration` as the string "sixty" would reach the unloading
 *    rules as a real, wrong number.
 */
export const SETTING_VALUE_TYPES = ['string', 'number', 'boolean'] as const;
export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];

export type SettingDefinition = {
  key: string;
  label: string;
  category: 'company' | 'operations' | 'localization';
  valueType: SettingValueType;
  defaultValue: string | number | boolean;
  /** A value the server refuses to blank. It is printed on every document. */
  required?: boolean;
};

/**
 * Every key the server will accept, and the screen that edits it.
 *
 * `localization.locale` and `localization.dateFormat` were removed rather than left in
 * place. They had no reader anywhere in the backend or the frontend, and the theme tab
 * already owns locale and date format — so they were a second, unwritten source of truth
 * for the same two facts, which is the condition this catalogue exists to prevent.
 *
 * `company.email` and `company.taxId` were the opposite case and are now on the form:
 * both are printed on documents, both were already writable, and neither had an input.
 * A setting that can be written but never edited is where values go to be lost.
 */
export const SETTING_CATALOGUE: readonly SettingDefinition[] = [
  { key: 'company.name', label: 'اسم الشركة', category: 'company', valueType: 'string', defaultValue: '', required: true },
  { key: 'company.address', label: 'العنوان', category: 'company', valueType: 'string', defaultValue: '' },
  { key: 'company.phone', label: 'الهاتف', category: 'company', valueType: 'string', defaultValue: '' },
  { key: 'company.email', label: 'البريد الإلكتروني', category: 'company', valueType: 'string', defaultValue: '' },
  { key: 'company.taxId', label: 'الرقم الضريبي', category: 'company', valueType: 'string', defaultValue: '' },
  { key: 'company.logoUrl', label: 'رابط الشعار', category: 'company', valueType: 'string', defaultValue: '' },
  { key: 'company.currency', label: 'العملة', category: 'company', valueType: 'string', defaultValue: 'EGP', required: true },
  { key: 'operations.defaultUnloadingDuration', label: 'مدة التفريغ الافتراضية (دقيقة)', category: 'operations', valueType: 'number', defaultValue: 60 },
  { key: 'operations.defaultDelayPenalty', label: 'غرامة التأخير الافتراضية', category: 'operations', valueType: 'number', defaultValue: 0 },
];

export type ResolvedSetting = SettingDefinition & {
  value: string | number | boolean;
  updatedAt: string | null;
  updatedById: string | null;
  reason: string | null;
  /** False when the catalogue default is in play, so a screen can say so. */
  isDefault: boolean;
};

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);
  private readonly byKey = new Map(SETTING_CATALOGUE.map((entry) => [entry.key, entry]));

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getAll(): Promise<{ settings: ResolvedSetting[] }> {
    const stored = await this.prisma.systemSetting.findMany();
    const storedByKey = new Map(stored.map((row) => [row.key, row]));

    const settings: ResolvedSetting[] = SETTING_CATALOGUE.map((definition) => {
      const row = storedByKey.get(definition.key);
      return {
        ...definition,
        value: row ? this.coerce(row.value, definition) : definition.defaultValue,
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
        updatedById: row?.updatedById ?? null,
        reason: row?.reason ?? null,
        isDefault: !row,
      };
    });

    return { settings };
  }

  async get(key: string): Promise<string | number | boolean> {
    const definition = this.requireDefinition(key);
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row ? this.coerce(row.value, definition) : definition.defaultValue;
  }

async update(dto: UpdateSystemSettingsDto, actorId: string | null) {
    const incoming = Array.isArray(dto?.settings) ? dto.settings : [];
    if (!incoming.length) {
      throw new BadRequestException('No settings supplied');
    }

    const before = await this.prisma.systemSetting.findMany();

// Validated as a batch first, so a bad entry cannot leave half the screen
    // written. A settings form that saves some of what you typed is worse than one
    // that refuses and tells you which field.
    const prepared = incoming.map((entry) => {
      const definition = this.requireDefinition(entry.key);
      const typed = this.validateValue(definition, entry.value);
      return {
        key: definition.key,
        value: String(typed),
        valueType: definition.valueType,
        category: definition.category,
        label: definition.label,
        reason: String(entry.reason || dto.reason || '').trim() || null,
      };
    });

    // Last-write-wins is how one administrator silently undoes another's company name.
    // The screen sends the `updatedAt` it read, and the write becomes a compare-and-set:
    // the update only matches the row version the operator actually saw. If somebody
    // saved in between, the condition matches nothing, the count is zero, and the whole
    // transaction is rolled back.
    //
    // A check that happens *before* the write and never again would not close this — it
    // loses exactly the race it exists to catch, which is why the comparison lives in
    // the `where` clause rather than in a lookup above it.
    const expectedByKey = new Map(
      incoming
        .map((entry, index) => [prepared[index].key, String(entry.expectedUpdatedAt || '').trim()] as const)
        .filter(([, expected]) => expected),
    );

    await this.prisma.$transaction(async (tx) => {
      for (const row of prepared) {
        const expected = expectedByKey.get(row.key);

        if (expected) {
          const updatedAt = new Date(expected);
          if (Number.isNaN(updatedAt.getTime())) {
            throw new BadRequestException(`${row.label}: the expected version is not a valid date`);
          }
          const result = await tx.systemSetting.updateMany({
            where: { key: row.key, updatedAt },
            data: { ...row, updatedById: actorId },
          });
          if (result.count === 0) {
            const current = await tx.systemSetting.findUnique({ where: { key: row.key } });
            throw new ConflictException(
              `${row.label}: عدّلها مستخدم آخر بعد أن فتحت الشاشة. `
              + `القيمة الحالية: ${current?.value ?? '(لم تُضبط بعد)'}. `
              + 'أعد تحميل الصفحة ثم عدّل مجددًا.',
            );
          }
          continue;
        }

        // No expectation means the operator had never seen a stored value for this key.
        await tx.systemSetting.upsert({
          where: { key: row.key },
          create: { ...row, updatedById: actorId },
          update: { ...row, updatedById: actorId },
        });
      }
    });

    const after = await this.prisma.systemSetting.findMany();
    const changed = this.diff(before, after, prepared);

    if (changed.length) {
      // The message is the part a human reads later: which keys moved and what
      // they became. "SYSTEM_SETTINGS_UPDATE" on its own answers nothing, and this
      // is the row that answers "who changed the company name on this report".
      const summary = changed
        .map((entry) => `${entry.key}: ${entry.from ?? '(unset)'} → ${entry.to}`)
        .join('; ');

      await this.audit.log({
        action: 'SYSTEM_SETTINGS_UPDATE',
        actorId: actorId ?? 'system',
        actorUsername: actorId ?? 'system',
        actorRole: 'unknown',
        targetResource: 'system_settings',
        entityType: 'SystemSetting',
        entityId: changed.map((entry) => entry.key).join(','),
        status: 'success',
        message: summary.slice(0, 900),
        metadata: { changed },
      }).catch((error: any) => {
        // The write is committed; a missing audit line is worth shouting about
        // but must not reach the operator as a failed save.
        this.logger.error(`Settings saved but the audit write failed: ${error?.message || error}`);
      });
    }

    const merged = await this.getAll();
    return { ...merged, changed: changed.map((entry) => entry.key) };
  }

  private diff(
    before: Array<{ key: string; value: string | null }>,
    after: Array<{ key: string; value: string | null }>,
    prepared: Array<{ key: string; value: string }>,
  ) {
    const beforeByKey = new Map(before.map((row) => [row.key, row.value]));
    return prepared
      .filter((row) => beforeByKey.get(row.key) !== row.value)
      .map((row) => ({ key: row.key, from: beforeByKey.get(row.key) ?? null, to: row.value }));
  }

  private requireDefinition(key: string): SettingDefinition {
    const definition = this.byKey.get(String(key || '').trim());
    if (!definition) {
      throw new BadRequestException(
        `Unknown setting "${key}". Add it to SETTING_CATALOGUE before writing it, so there is a screen that shows it.`,
      );
    }
    return definition;
  }

  private validateValue(definition: SettingDefinition, raw: unknown): string | number | boolean {
    if (definition.valueType === 'number') {
      // NaN is the trap: `Number('-')` is NaN, `NaN ?? 60` is NaN, and it
      // serialises to null on the wire. The old number inputs in the settings form
      // did exactly this and reached the unloading rules.
      const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
      if (!Number.isFinite(value)) {
        throw new BadRequestException(`${definition.label} must be a number`);
      }
      if (value < 0) {
        throw new BadRequestException(`${definition.label} must not be negative`);
      }
      return value;
    }

    if (definition.valueType === 'boolean') {
      if (typeof raw === 'boolean') return raw;
      const text = String(raw ?? '').trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(text)) return true;
      if (['false', '0', 'no', 'off'].includes(text)) return false;
      throw new BadRequestException(`${definition.label} must be true or false`);
    }

    if (raw !== null && raw !== undefined && typeof raw === 'object') {
      throw new BadRequestException(`${definition.label} must be text`);
    }
    const text = String(raw ?? '');
    // The company name and the currency are the two values printed at the top of
    // every stock card, statement and operations report. Blanking one is not a
    // cosmetic mistake, and the form has no way to undo it after the fact, so it is
    // refused here rather than accepted as an empty string.
    if (definition.required && !text.trim()) {
      throw new BadRequestException(`${definition.label} is required and cannot be left blank`);
    }
    return text;
  }

  private coerce(stored: string | null, definition: SettingDefinition): string | number | boolean {
    if (definition.valueType === 'number') {
      const value = Number(stored);
      return Number.isFinite(value) ? value : definition.defaultValue;
    }
    if (definition.valueType === 'boolean') {
      return String(stored).toLowerCase() === 'true';
    }
    return stored ?? definition.defaultValue;
  }
}
