import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '@api/client';
import {
  createCategoryInApi,
  createUnitInApi,
  deleteCategoryInApi,
  deleteUnitInApi,
  fetchReferenceData,
  fetchReferenceDataUsageCounts,
} from './referenceDataService';

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

describe('referenceDataService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and normalizes reference data from the backend', async () => {
    getMock.mockResolvedValue({
      data: {
        data: {
          categories: [' خامات ', '', null],
          units: [' طن ', 'كجم'],
        },
      },
    });

    await expect(fetchReferenceData()).resolves.toEqual({
      categories: ['خامات'],
      units: ['طن', 'كجم'],
    });
    expect(getMock).toHaveBeenCalledWith('/reference-data');
  });

  it('creates categories and units through persistent API endpoints', async () => {
    postMock.mockResolvedValue({ data: { data: { categories: ['خامات'], units: ['طن'] } } });

    await expect(createCategoryInApi('خامات')).resolves.toEqual({ categories: ['خامات'], units: ['طن'] });
    expect(postMock).toHaveBeenCalledWith('/reference-data/categories', { value: 'خامات' });

    await expect(createUnitInApi('طن')).resolves.toEqual({ categories: ['خامات'], units: ['طن'] });
    expect(postMock).toHaveBeenCalledWith('/reference-data/units', { value: 'طن' });
  });

  it('deletes categories and units through persistent API endpoints', async () => {
    postMock.mockResolvedValue({ data: { data: { categories: [], units: [] } } });

    await deleteCategoryInApi('خامات');
    await deleteUnitInApi('طن');

    expect(postMock).toHaveBeenCalledWith('/reference-data/categories/delete', { value: 'خامات' });
    expect(postMock).toHaveBeenCalledWith('/reference-data/units/delete', { value: 'طن' });
  });
});

/**
 * Gate 4.4 — the usage count decides whether a destructive button is enabled, so a
 * malformed response is treated as "no information" rather than "not in use".
 *
 * The distinction is the whole point. `{}` and `{ 'x': 0 }` look like the same thing
 * to a panel that just reads a number, and collapsing them re-creates the false
 * statement the server-side count was introduced to remove: a referenced value
 * reported as free, next to a Delete button that is live.
 */
describe('fetchReferenceDataUsageCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads both maps from the server endpoint', async () => {
    getMock.mockResolvedValue({
      data: { data: { categories: { 'خامات': 12 }, units: { 'طن': 3 } } },
    });

    await expect(fetchReferenceDataUsageCounts()).resolves.toEqual({
      categories: { 'خامات': 12 },
      units: { 'طن': 3 },
    });
    expect(getMock).toHaveBeenCalledWith('/reference-data/usage-counts');
  });

  it('lowercases keys and drops entries that carry no count', async () => {
    getMock.mockResolvedValue({
      data: { data: { categories: { 'خامات ': 4, 'طن': 0, '': 9 }, units: {} } },
    });

    await expect(fetchReferenceDataUsageCounts()).resolves.toEqual({
      categories: { 'خامات': 4 },
      units: {},
    });
  });

  it('returns empty maps for a response that is not a pair of maps', async () => {
    getMock.mockResolvedValue({ data: { data: { categories: ['خامات'], units: null } } });

    await expect(fetchReferenceDataUsageCounts()).resolves.toEqual({
      categories: {},
      units: {},
    });
  });

  it('propagates a failure rather than reporting every value as unused', async () => {
    getMock.mockRejectedValue({ response: { status: 500, data: { message: 'boom' } } });

    await expect(fetchReferenceDataUsageCounts()).rejects.toThrow(/boom/);
  });
});