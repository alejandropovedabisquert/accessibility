process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = '*';

import path from 'path';
import os from 'os';
import fs from 'fs';

// Cada ejecucion de tests escribe en su propio directorio temporal.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.RESULTS_DIR = path.join(tmp, 'results');

export const tmpRoot = tmp;
