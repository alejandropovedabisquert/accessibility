import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const resolveDir = (value: string | undefined, fallback: string): string =>
  path.resolve(process.cwd(), value && value.trim().length > 0 ? value : fallback);

const corsOrigin = (process.env.CORS_ORIGIN ?? 'http://localhost:3001').trim();

export interface Config {
  port: number;
  nodeEnv: string;
  isTest: boolean;
  corsOrigin: string[] | '*';
  dataDir: string;
  resultsDir: string;
  scanConcurrency: number;
  browserIdleTimeoutMs: number;
  maxUrlsPerAudit: number;
  defaultTimeoutMs: number;
}

const config: Config = {
  port: int(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isTest: process.env.NODE_ENV === 'test',
  corsOrigin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o) => o.trim()).filter(Boolean),
  dataDir: resolveDir(process.env.DATA_DIR, './data'),
  resultsDir: resolveDir(process.env.RESULTS_DIR, './scan-results'),
  scanConcurrency: int(process.env.SCAN_CONCURRENCY, 3),
  browserIdleTimeoutMs: int(process.env.BROWSER_IDLE_TIMEOUT_MS, 60_000),
  maxUrlsPerAudit: int(process.env.MAX_URLS_PER_AUDIT, 25),
  defaultTimeoutMs: int(process.env.DEFAULT_TIMEOUT_MS, 30_000),
};

export default config;
