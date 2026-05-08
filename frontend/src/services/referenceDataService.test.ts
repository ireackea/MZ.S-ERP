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