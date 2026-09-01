import request from 'supertest';
import type { Express } from 'express';

/** Sondea GET /api/audits/:id hasta que la auditoria deja de estar en curso. */
export const waitForAudit = async (app: Express, id: string, timeoutMs = 90_000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/audits/${id}`);
    if (res.status !== 200) throw new Error(`GET /api/audits/${id} devolvio ${res.status}`);
    if (res.body.status === 'completed' || res.body.status === 'failed') return res.body;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`La auditoria ${id} no termino en ${timeoutMs}ms`);
};
