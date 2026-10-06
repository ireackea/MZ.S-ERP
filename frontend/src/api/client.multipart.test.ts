import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import apiClient from '@api/client';

/**
 * B21 — a multipart body has to arrive as multipart.
 *
 * ## What this test is for
 *
 * The import route was live, the server accepted a real archive, the end-to-end spec
 * passed — and the button in the interface answered «لم يُرفَق ملف» to every attempt.
 *
 * All three of those were true at once, and the reason is the point of this file: the
 * e2e spec posted a `FormData` through bare `fetch`, which sets
 * `Content-Type: multipart/form-data; boundary=…` by itself. The interface posts
 * through `apiClient`, which sets `Content-Type: application/json` on *every*
 * request. The browser then sends a multipart body labelled as JSON, the boundary
 * never appears, multer parses zero files, and the handler reports that no file was
 * attached.
 *
 * So the e2e spec proved the server works and said nothing about the button, because
 * it was not the code the button uses. A test that exercises a different client is a
 * test of a different thing, and the difference was invisible until an operator
 * clicked.
 *
 * This test uses `apiClient` — the same instance the interface uses — and asserts on
 * the headers that actually leave it.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the shared API client, when the body is a FormData', () => {
  let adapter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = vi.fn(async (config) => ({
      data: { success: true },
      status: 201,
      statusText: 'Created',
      headers: {},
      config,
    }));
    apiClient.defaults.adapter = adapter as never;
  });

  afterEach(() => {
    delete (apiClient.defaults as { adapter?: unknown }).adapter;
  });

  it('never labels a FormData body as JSON', async () => {
    const form = new FormData();
    form.append('file', new Blob(['archive-bytes']), 'backup.ffbkp');

    await apiClient.post('/backup/import', form);

    const sent = adapter.mock.calls[0][0] as { headers: Record<string, string> };
    const contentType = Object.entries(sent.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'content-type',
    );

    // The defect, stated precisely: a `multipart/form-data` body labelled
    // `application/json` arrives with no boundary, so multer parses zero files and
    // the handler reports that no file was attached — which is exactly what the
    // import button did.
    //
    // Asserted as "not JSON" rather than "absent" on purpose. Which header ends up on
    // the request after this interceptor depends on the *adapter*: axios's browser
    // adapter drops it and lets the runtime generate the boundary, while its own
    // urlencoded default leaks through when a test supplies a mock adapter. Asserting
    // absence here would be asserting the behaviour of the mock rather than of the
    // product.
    expect(contentType?.[1] ?? '').not.toContain('application/json');
  });

  it('still sends JSON Content-Type for a normal body', async () => {
    // The fix must not break every other request in the product, and it must not be
    // satisfied by simply removing the header everywhere.
    await apiClient.post('/backup/restore', { backupId: 'x', confirmRestore: false });

    const sent = adapter.mock.calls[0][0] as { headers: Record<string, string> };
    const contentType = Object.entries(sent.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'content-type',
    );
    expect(contentType?.[1]).toContain('application/json');
  });

  it('keeps the body intact, boundary-free header and all', async () => {
    const form = new FormData();
    form.append('file', new Blob(['archive-bytes']), 'backup.ffbkp');
    form.append('decryptionPassword', 'secret');

    await apiClient.post('/backup/import', form);
    await flush();

    const sent = adapter.mock.calls[0][0] as { data: FormData };
    expect(sent.data).toBeInstanceOf(FormData);
    // The field the route reads by name. A body that arrives with the right bytes
    // under the wrong name is the same failure from the operator's side.
    expect(sent.data.get('file')).toBeTruthy();
    expect(sent.data.get('decryptionPassword')).toBe('secret');
  });
});
