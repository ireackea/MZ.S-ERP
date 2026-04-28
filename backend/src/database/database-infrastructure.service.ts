import { Injectable, InternalServerErrorException, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

type SequenceTarget = {
  tableName: string;
  columnName: string;
  minimumValue?: number;
};

@Injectable()
export class DatabaseInfrastructureService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseInfrastructureService.name);
  private pool: Pool | null = null;

  private getPool(): Pool {
    if (this.pool) return this.pool;

    const connectionString = String(process.env.DATABASE_URL || '').trim();
    if (!connectionString) {
      throw new InternalServerErrorException('DATABASE_URL is required for database infrastructure operations.');
    }

    this.pool = new Pool({ connectionString });
    return this.pool;
  }

  private quoteIdentifier(value: string): string {
    return `"${String(value || '').replace(/"/g, '""')}"`;
  }

  async probeConnection(): Promise<boolean> {
    const client = await this.getPool().connect();

    try {
      await client.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.warn(`Database reachability probe failed: ${String((error as Error)?.message || error)}`);
      return false;
    } finally {
      client.release();
    }
  }

  async syncPrimaryKeySequences(targets: SequenceTarget[]): Promise<void> {
    if (!targets.length) return;

    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      for (const target of targets) {
        const tableIdentifier = this.quoteIdentifier(target.tableName);
        const columnIdentifier = this.quoteIdentifier(target.columnName);
        const minimumValue = Math.max(1, Math.floor(Number(target.minimumValue || 1)));
        const sequenceNameSql = `pg_get_serial_sequence('${tableIdentifier}', '${String(target.columnName || '').replace(/'/g, "''")}')`;

        await client.query(
          `SELECT setval(${sequenceNameSql}, GREATEST(COALESCE((SELECT MAX(${columnIdentifier}) FROM ${tableIdentifier}), $1), $1), true);`,
          [minimumValue],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
  }
}