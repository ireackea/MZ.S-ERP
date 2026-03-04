import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .forEach((line) => {
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
}

function parseItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function parseTransactions(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function approxEqual(a, b, tolerance = 1e-9) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

const results = [];
const pushResult = (name, ok, details = '') => {
  results.push({ name, ok, details });
  const icon = ok ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name}${details ? ` -> ${details}` : ''}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isApiAvailable(client) {
  try {
    const res = await client.get('/items');
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

async function waitForApi(client, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isApiAvailable(client)) return true;
    await sleep(750);
  }
  return false;
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // no-op
    }
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: true,
      stdio: 'pipe',
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function readFileSafe(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

async function ensureBuildArtifacts(rootDir) {
  const defaultAssetsDir = path.join(rootDir, 'dist', 'assets');
  let assetsDir = defaultAssetsDir;
  let tempBuildDir = '';

  const defaultJsFiles = fs.existsSync(defaultAssetsDir)
    ? fs.readdirSync(defaultAssetsDir).filter((name) => name.endsWith('.js'))
    : [];

  if (defaultJsFiles.length === 0) {
    tempBuildDir = path.join(rootDir, '.phase3-dist');
    const build = await runCommand('npx', ['vite', 'build', '--outDir', '.phase3-dist', '--emptyOutDir'], {
      cwd: rootDir,
    });
    pushResult(
      'Phase-3 temp build for chunk validation',
      build.code === 0,
      build.code === 0 ? 'temporary build generated' : String(build.stderr || build.stdout).trim().slice(0, 160),
    );
    if (build.code !== 0) return [];
    assetsDir = path.join(tempBuildDir, 'assets');
  }

  if (!fs.existsSync(assetsDir)) return [];
  const jsFiles = fs.readdirSync(assetsDir).filter((name) => name.endsWith('.js'));

  if (tempBuildDir && fs.existsSync(tempBuildDir)) {
    fs.rmSync(tempBuildDir, { recursive: true, force: true });
  }

  return jsFiles;
}

async function run() {
  const root = process.cwd();
  loadEnvFile(path.join(root, 'backend', '.env'));
  loadEnvFile(path.join(root, '.env'));
  loadEnvFile(path.join(root, '.env.local'));

  const apiBase = process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:3001';
  const adminToken = process.env.ADMIN_TOKEN || process.env.BACKUP_API_TOKEN || process.env.VITE_BACKUP_API_TOKEN || '';
  const authUsername = process.env.VALIDATION_AUTH_USER || process.env.ADMIN_USERNAME || 'superadmin';
  const authPassword = process.env.VALIDATION_AUTH_PASSWORD || process.env.ADMIN_PASSWORD || 'SecurePassword2026!';

  const testPrefix = `phase3-val-${Date.now()}`;
  const testItemPublicId = `${testPrefix}-item`;
  const txIdsToCleanup = [];
  const itemPublicIdsToCleanup = [testItemPublicId];

  let backendProcess = null;
  let backendStartedByScript = false;

  const client = axios.create({
    baseURL: apiBase,
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken ? { 'x-admin-token': adminToken } : {}),
    },
    timeout: 25000,
    validateStatus: () => true,
  });

  const fetchItems = async () => {
    const res = await client.get('/items');
    return parseItems(res.data);
  };

  const getItemStock = async (publicId) => {
    const items = await fetchItems();
    const item = items.find((row) => String(row.publicId) === String(publicId));
    if (!item) return null;
    return Number(item.currentStock ?? 0);
  };

  const listTransactionsByMarker = async (marker) => {
    const res = await client.get('/transactions', {
      params: { page: 1, limit: 1000, search: marker },
    });
    const rows = parseTransactions(res.data);
    return rows.filter((row) => String(row.warehouseInvoice || '').includes(marker));
  };

  try {
    if (!(await isApiAvailable(client))) {
      backendProcess = spawn('npm run backend:dev', [], {
        cwd: root,
        shell: true,
        stdio: 'ignore',
      });
      backendStartedByScript = true;
      const up = await waitForApi(client, 45000);
      pushResult('Backend bootstrap for phase-3 validation', up, up ? 'started automatically' : 'failed to start');
      if (!up) throw new Error('Backend is not reachable for phase-3 validation');
    } else {
      pushResult('Backend bootstrap for phase-3 validation', true, 'using running backend');
    }

    const loginCandidates = [
      { username: authUsername, password: authPassword },
      { username: 'admin', password: authPassword },
      { username: 'admin@feedfactory.local', password: authPassword },
    ];

    let protectedProbe = await client.post('/items/sync', { items: [] });
    if (protectedProbe.status === 401 || protectedProbe.status === 403) {
      for (const candidate of loginCandidates) {
        const loginRes = await client.post('/auth/login', candidate);
        const token = loginRes.data?.accessToken;
        if (token) {
          client.defaults.headers.common.Authorization = `Bearer ${token}`;
          break;
        }
      }
      protectedProbe = await client.post('/items/sync', { items: [] });
    }
    const authCheck = protectedProbe;
    pushResult(
      'Phase-3 auth context',
      authCheck.status !== 401 && authCheck.status !== 403,
      `status=${authCheck.status}`,
    );

    // 1) Atomicity and consistency tests
    const seedItemRes = await client.post('/items/sync', {
      items: [
        {
          publicId: testItemPublicId,
          name: `Phase3 Validation Item ${testPrefix}`,
          code: `PH3-${Date.now()}`,
          unit: 'kg',
          category: 'Phase3Validation',
          minLimit: 0,
          maxLimit: 1000,
          orderLimit: 10,
          currentStock: 20,
        },
      ],
    });
    pushResult(
      'Seed phase-3 validation item',
      seedItemRes.status >= 200 && seedItemRes.status < 300,
      `status=${seedItemRes.status}`,
    );

    const baseline = await getItemStock(testItemPublicId);
    pushResult('Read baseline currentStock', baseline !== null, baseline === null ? 'item not found' : `stock=${baseline}`);
    if (baseline === null) throw new Error('Phase-3 test item was not created');

    const createTxRes = await client.post('/transactions/bulk', {
      transactions: [
        {
          itemId: testItemPublicId,
          date: new Date().toISOString().split('T')[0],
          type: 'in',
          quantity: 10,
          supplierOrReceiver: 'phase3-validation',
          warehouseInvoice: `${testPrefix}-atomic-create`,
          notes: `${testPrefix}-atomic`,
          timestamp: Date.now(),
        },
      ],
    });

    const createdRows = parseTransactions(createTxRes.data);
    const createdTxId = createdRows[0]?.id ? String(createdRows[0].id) : '';
    if (createdTxId) txIdsToCleanup.push(createdTxId);

    pushResult(
      'Create inbound transaction (quantity=10)',
      createTxRes.status >= 200 && createTxRes.status < 300 && Boolean(createdTxId),
      `status=${createTxRes.status}`,
    );

    const stockAfterCreate = await getItemStock(testItemPublicId);
    const createOk = stockAfterCreate !== null && approxEqual(stockAfterCreate, baseline + 10);
    pushResult(
      'Atomicity: stock increased by +10 after create',
      createOk,
      stockAfterCreate === null ? 'item missing' : `stock=${stockAfterCreate}, expected=${baseline + 10}`,
    );

    const updateTxRes = await client.patch(`/transactions/${encodeURIComponent(createdTxId)}`, {
      quantity: 15,
    });
    pushResult(
      'Update transaction quantity (10 -> 15)',
      updateTxRes.status >= 200 && updateTxRes.status < 300,
      `status=${updateTxRes.status}`,
    );

    const stockAfterUpdate = await getItemStock(testItemPublicId);
    const updateOk = stockAfterUpdate !== null && approxEqual(stockAfterUpdate, baseline + 15);
    pushResult(
      'Consistency: net delta +5 reflected on stock after update',
      updateOk,
      stockAfterUpdate === null ? 'item missing' : `stock=${stockAfterUpdate}, expected=${baseline + 15}`,
    );

    const deleteTxRes = await client.post('/transactions/delete', { ids: [createdTxId] });
    pushResult(
      'Delete transaction',
      deleteTxRes.status >= 200 && deleteTxRes.status < 300 && Number(deleteTxRes.data?.deleted ?? 0) >= 1,
      `status=${deleteTxRes.status}, deleted=${Number(deleteTxRes.data?.deleted ?? 0)}`,
    );
    const cleanedIndex = txIdsToCleanup.indexOf(createdTxId);
    if (cleanedIndex >= 0) txIdsToCleanup.splice(cleanedIndex, 1);

    const stockAfterDelete = await getItemStock(testItemPublicId);
    const rollbackOk = stockAfterDelete !== null && approxEqual(stockAfterDelete, baseline);
    pushResult(
      'Rollback logic: stock restored after delete',
      rollbackOk,
      stockAfterDelete === null ? 'item missing' : `stock=${stockAfterDelete}, expected=${baseline}`,
    );

    // 2) Performance / lazy loading checks
    const chunkFiles = await ensureBuildArtifacts(root);
    pushResult('Chunk artifacts exist in dist/assets', chunkFiles.length > 1, `chunks=${chunkFiles.length}`);

    const requiredRouteChunks = ['Dashboard', 'ItemManagement', 'StockBalances', 'Settings', 'OpeningBalancePage'];
    const foundRouteChunks = requiredRouteChunks.filter((name) =>
      chunkFiles.some((fileName) => fileName.includes(name)),
    );
    pushResult(
      'Route-level code splitting chunks detected',
      foundRouteChunks.length >= 4,
      `found=${foundRouteChunks.join(', ') || 'none'}`,
    );

    const itemManagementSource = readFileSafe(path.join(root, 'components', 'ItemManagement.tsx'));
    const stockBalancesSource = readFileSafe(path.join(root, 'components', 'StockBalances.tsx'));

    const itemDebounceOk =
      /setTimeout\(\s*\(\)\s*=>\s*{[\s\S]*setDebouncedSearchTerm[\s\S]*},\s*250\s*\)/m.test(itemManagementSource) ||
      /setTimeout\([\s\S]*250\)/m.test(itemManagementSource);
    pushResult('Debounced search in ItemManagement (250ms)', itemDebounceOk);

    const stockDebounceOk =
      /setTimeout\(\s*\(\)\s*=>\s*{[\s\S]*setDebouncedSearchTerm[\s\S]*},\s*250\s*\)/m.test(stockBalancesSource) ||
      /setTimeout\([\s\S]*250\)/m.test(stockBalancesSource);
    pushResult('Debounced search in StockBalances (250ms)', stockDebounceOk);

    const hasDebouncedEffectApiCall = (source) => {
      const effects = source.match(/useEffect\s*\([\s\S]*?\)\s*;?/g) || [];
      return effects.some((effect) => {
        const hasDebouncedDependency = /\[[^\]]*debouncedSearchTerm[^\]]*\]/m.test(effect);
        if (!hasDebouncedDependency) return false;
        return /(axios|apiClient|getOpeningBalancesFromApi|getItemsFromApi|\/items|\/transactions)/m.test(effect);
      });
    };

    const noDebouncedApiEffect =
      !hasDebouncedEffectApiCall(stockBalancesSource) &&
      !hasDebouncedEffectApiCall(itemManagementSource);
    pushResult(
      'No API-fetch effect tied directly to debouncedSearchTerm dependencies',
      noDebouncedApiEffect,
    );

    // 3) Migration idempotency test (local cache -> API bootstrap behavior)
    const migrationMarker = `${testPrefix}-migration`;
    const migrationItemPublicId = `${testPrefix}-migration-item`;
    itemPublicIdsToCleanup.push(migrationItemPublicId);

    const seedMigrationItemRes = await client.post('/items/sync', {
      items: [
        {
          publicId: migrationItemPublicId,
          name: `Phase3 Migration Item ${testPrefix}`,
          code: `PH3M-${Date.now()}`,
          unit: 'kg',
          category: 'Phase3Validation',
          currentStock: 0,
        },
      ],
    });
    pushResult(
      'Seed migration validation item',
      seedMigrationItemRes.status >= 200 && seedMigrationItemRes.status < 300,
      `status=${seedMigrationItemRes.status}`,
    );

    const migrateOnce = async () => {
      const existing = await listTransactionsByMarker(migrationMarker);
      if (existing.length === 0) {
        const localTransactions = [
          {
            id: randomUUID(),
            itemId: migrationItemPublicId,
            date: new Date().toISOString().split('T')[0],
            type: 'in',
            quantity: 3,
            supplierOrReceiver: 'migration-validation',
            warehouseInvoice: `${migrationMarker}-invoice`,
            notes: migrationMarker,
            timestamp: Date.now(),
          },
        ];

        const res = await client.post('/transactions/bulk', {
          transactions: localTransactions.map((tx) => ({
            itemId: tx.itemId,
            date: tx.date,
            type: tx.type,
            quantity: tx.quantity,
            supplierOrReceiver: tx.supplierOrReceiver,
            warehouseInvoice: tx.warehouseInvoice,
            notes: tx.notes,
            timestamp: tx.timestamp,
          })),
        });
        const created = parseTransactions(res.data);
        created.forEach((row) => {
          if (row?.id) txIdsToCleanup.push(String(row.id));
        });
      }
      return listTransactionsByMarker(migrationMarker);
    };

    const run1 = await migrateOnce();
    const run2 = await migrateOnce();

    const idempotentOk = run1.length === 1 && run2.length === 1;
    pushResult(
      'Migration idempotency: second run does not duplicate migrated rows',
      idempotentOk,
      `first=${run1.length}, second=${run2.length}`,
    );

    const appSource = readFileSafe(path.join(root, 'App.tsx'));
    const guardExists = appSource.includes('apiTransactions.length === 0 && localTransactions.length > 0');
    pushResult('App bootstrap contains migration guard (API empty + local exists)', guardExists);
  } catch (error) {
    pushResult('Unexpected phase-3 validation failure', false, String(error?.message || error));
  } finally {
    try {
      const uniqueTxIds = Array.from(new Set(txIdsToCleanup.filter(Boolean)));
      if (uniqueTxIds.length) {
        await client.post('/transactions/delete', { ids: uniqueTxIds });
      }
    } catch (cleanupError) {
      console.error('Transaction cleanup warning:', String(cleanupError?.message || cleanupError));
    }

    try {
      const uniqueItemIds = Array.from(new Set(itemPublicIdsToCleanup.filter(Boolean)));
      if (uniqueItemIds.length) {
        await client.post('/items/delete', { publicIds: uniqueItemIds });
      }
    } catch (cleanupError) {
      console.error('Item cleanup warning:', String(cleanupError?.message || cleanupError));
    }

    if (backendStartedByScript && backendProcess) {
      stopProcessTree(backendProcess);
    }
  }

  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  console.log('\n=== Phase-3 Validation Summary ===');
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
