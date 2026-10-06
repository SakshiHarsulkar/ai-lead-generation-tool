// In production on Vercel, VITE_API_URL points at the Render API. Locally Vite proxies /api.
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  health: () => request('/health'),
  meta: () => request('/meta'),
  sample: () => request('/sample'),
  preview: (input) => request('/preview', { method: 'POST', body: { input } }),
  listBatches: () => request('/batches'),
  createBatch: (payload) => request('/batches', { method: 'POST', body: payload }),
  getBatch: (id) => request(`/batches/${id}`),
  deleteBatch: (id) => request(`/batches/${id}`, { method: 'DELETE' }),
  processBatch: (id) => request(`/batches/${id}/process`, { method: 'POST' }),
  rescore: (id, payload) => request(`/batches/${id}/rescore`, { method: 'POST', body: payload }),
  retryLead: (id) => request(`/leads/${id}/retry`, { method: 'POST' }),
  exportUrl: (id, format, ids) => `${BASE}/api/batches/${id}/export?format=${format}${ids ? `&ids=${ids.join(',')}` : ''}`,
};
