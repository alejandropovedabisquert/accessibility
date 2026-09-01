import type { Request, Response } from 'express';
import { chromium, devices, firefox, webkit } from 'playwright';
import { AVAILABLE_TAGS, DEFAULT_TAGS } from '../services/scanner/scan.service';
import auditService from '../services/audit/audit.service';
import config from '../config/config';

const BROWSERS = [
  { id: chromium.name(), name: 'Chromium' },
  { id: firefox.name(), name: 'Firefox' },
  { id: webkit.name(), name: 'WebKit' },
];

// La lista de dispositivos de Playwright es estatica: se calcula una sola vez.
const DEVICES = Object.entries(devices).map(([name, descriptor]) => ({
  name,
  viewport: descriptor.viewport,
  isMobile: descriptor.isMobile,
  hasTouch: descriptor.hasTouch,
}));

export const getMeta = (_req: Request, res: Response) => {
  res.json({
    browsers: BROWSERS,
    devices: DEVICES,
    tags: AVAILABLE_TAGS,
    defaults: {
      browser: 'chromium',
      waitUntil: 'load',
      tags: DEFAULT_TAGS,
      timeout: config.defaultTimeoutMs,
      viewport: { width: 1366, height: 768 },
    },
    limits: {
      maxUrlsPerAudit: config.maxUrlsPerAudit,
      scanConcurrency: config.scanConcurrency,
    },
  });
};

export const getStats = (_req: Request, res: Response) => {
  res.json(auditService.stats());
};
