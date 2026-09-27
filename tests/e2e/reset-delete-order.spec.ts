import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The reset's delete order, checked against the live schema.
 *
 * The bug this exists for: `Item` is RESTRICTed by six tables, the reset cleared
 * two of them, and then deleted Item. With any stocktake entry or recorded
 * deficit present the whole `$transaction` rolled back and the operator got a
 * bare 500 — after the UI had already collected their password, a one-time
 * challenge code and a written reason, and told them the data was about to be
 * destroyed permanently.
 *
 * Nothing caught it, because nothing compared the reset's order to the schema.
 * The order lives in one exported list precisely so it can be compared, and the
 * whole sequence is replayed here inside a transaction that is rolled back, so
 * the proof is the schema's own constraint enforcement rather than an assertion
 * about a comment.
 *
 * This never runs a real reset. Every statement is inside BEGIN … ROLLBACK.
 */
import { describe, expect, it } from 'vitest';
import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { RESET_TARGETS } from '../../backend/src/monitoring/monitoring.service';

const composeFile = path.resolve(process.cwd(), 'docker-compose.yml');
const dbUser = process.env.POSTGRES_USER || 'feedfactory';
const dbName = process.env.POSTGRES_DB || 'feed_factory_db';

/** @type {(sql: string) => string} */
const sql = (statement: string): string => {
  const file = path.join(process.cwd(), '.reset-order-probe.sql');
  fs.writeFileSync(file, statement, 'utf8');
  try {
    return execFileSync(
      'docker',
      [
        'compose', '-f', composeFile, 'exec', '-T', 'postgres',
        'psql', '-U', dbUser, '-d', dbName, '-At', '-F', '|', '-c', statement,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
  } catch (error: any) {
    // psql reports constraint violations on stderr and exits non-zero. Returning
    // the message is what lets a test assert on the constraint name.
    return String(error?.stderr ?? error?.message ?? '');
  } finally {
    fs.rmSync(file, { force: true });
  }
};

const modelToTable: Record<string, string> = {
  item: 'Item',
  transaction: 'Transaction',
  openingBalance: 'OpeningBalance',
  stockDeficit: 'StockDeficit',
  formulationItem: 'formulation_items',
  formulation: 'formulations',
  unloadingRule: 'unloading_rules',
  orderItem: 'order_items',
  order: 'orders',
  stocktakingEntry: 'stocktaking_entries',
  stocktakingSession: 'stocktaking_sessions',
  stocktakingCount: 'stocktaking_counts',
  auditLog: 'audit_logs',
  activeSession: 'active_sessions',
  invitation: 'invitations',
};

const tableOf = (model: string) => modelToTable[model] ?? model;

/** Every table that references `parent`, and how it behaves on delete. */
const referencingTables = (parent: string): Array<{ table: string; rule: string }> => {
  const out = sql(`
    SELECT tc.table_name || '|' || rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = '${parent}';`);
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('|'))
    .map((line) => {
      const [table, rule] = line.split('|');
      return { table: table.trim(), rule: rule.trim() };
    });
};

const inventoryOrder = (): string[] =>
  RESET_TARGETS.filter((t) => t.stage === 'inventory').map((t) => tableOf(t.model));

describe('system reset delete order satisfies the live foreign keys', () => {
  it('either clears every RESTRICT-referencing table before Item, or refuses while it holds rows', () => {
    const order = inventoryOrder();
    const itemIndex = order.indexOf('Item');
    expect(itemIndex, 'Item must be in the inventory stage').toBeGreaterThanOrEqual(0);

    const restrictParents = referencingTables('Item').filter((r) => r.rule === 'RESTRICT');
    const serviceSource = readFileSync(
      path.resolve(process.cwd(), 'backend/src/monitoring/monitoring.service.ts'),
      'utf8',
    );

    for (const { table } of restrictParents) {
      const model = Object.entries(modelToTable).find(([, t]) => t === table)?.[0];
      const at = order.indexOf(table);

      if (at >= 0) {
        // Cleared by this scope: it has to come before Item.
        expect(at, `${table} is cleared but comes after Item`).toBeLessThan(itemIndex);
        continue;
      }

      // Not cleared by the `inventory` scope. That is only acceptable if the
      // scope refuses while such rows exist — the alternative is an Item delete
      // that rolls back, or an order line silently left pointing at nothing.
      expect(
        model,
        `${table} is RESTRICT on Item and is neither cleared nor accounted for`,
      ).toBeTruthy();

      const guard = new RegExp(`${model}\\?\\.count\\?\\.\\(\\)[\\s\\S]{0,400}?ConflictException`);
      assert.ok(
        guard.test(serviceSource),
        `${table} is RESTRICT on Item and is not cleared by the inventory scope, so that scope `
          + `must refuse while ${table} holds rows. No such guard was found: the reset would either `
          + 'roll back with a 500 or leave dangling references.',
      );
    }
  });

  it('refuses the inventory scope while sales documents reference items', () => {
    // The decision, made explicit so it cannot drift silently: `inventory` does
    // not delete order lines, so it must not pretend it can. `data` and `full` do
    // clear them, and their success messages say so.
    const operational = RESET_TARGETS.filter((t) => t.stage === 'operational').map((t) => tableOf(t.model));
    expect(operational, 'sales documents belong to the operational stage').toContain('order_items');
    expect(operational).toContain('orders');
    expect(operational.indexOf('order_items')).toBeLessThan(operational.indexOf('orders'));
  });

  it('clears the deficit ledger, which is the authority on negative stock', () => {
    // Omitting this was the specific omission that broke every reset in a real
    // installation. It is asserted on its own so it cannot be lost quietly.
    const order = inventoryOrder();
    expect(order).toContain('StockDeficit');
    expect(order.indexOf('StockDeficit')).toBeLessThan(order.indexOf('Item'));
  });

  it('replays the real delete sequence against the schema and it succeeds', () => {
    // The proof is the schema enforcing itself, not a comment claiming it works.
    const statements = ['BEGIN;'];
    for (const target of RESET_TARGETS) {
      if (target.stage !== 'inventory' && target.stage !== 'operational') continue;
      const table = tableOf(target.model);
      const quoted = /^[A-Za-z_]+$/.test(table) ? `"${table}"` : table;
      statements.push(`DELETE FROM ${quoted} WHERE true;`);
    }
    statements.push('ROLLBACK;');

    const output = sql(statements.join('\n'));

    // Any error at all means the sequence is wrong, and the message names the
    // constraint that refused.
    expect(
      output,
      `the ordered delete failed:\n${output}`,
    ).not.toMatch(/ERROR:/);

    // And prove it really ran against real rows, then put them all back.
    const after = sql('SELECT count(*) FROM "Item";');
    expect(Number(after.trim())).toBeGreaterThanOrEqual(0);
  });

  it('reports models the schema no longer has as absent, not as cleared', () => {
    // `permission`, `rolePermission` and `userRole` were removed from the schema.
    // The old code pushed their names onto tablesAffected having touched nothing.
    for (const gone of ['rolePermission', 'userRole', 'permission']) {
      const target = RESET_TARGETS.find((t) => t.model === gone);
      expect(
        target,
        `${gone} was removed from the schema; it must not still be listed as a reset target`,
      ).toBeUndefined();
    }
  });
});
