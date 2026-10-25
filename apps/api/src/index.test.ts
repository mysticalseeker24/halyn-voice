import { describe, expect, it } from 'vitest';
import app from './index';

describe('GET /health', () => {
  it('answers 200 with the service name', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'halyn-api' });
  });
});
