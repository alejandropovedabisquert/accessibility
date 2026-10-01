#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ApiClient } from './api.js';
import { createServer } from './tools.js';

// Por stdio: stdout es el canal del protocolo, cualquier log va a stderr.
const api = new ApiClient(process.env.A11Y_API_URL ?? 'http://localhost:3000/api');
const assertor = {
  name: process.env.A11Y_ASSERTOR_NAME ?? 'Claude',
  model: process.env.A11Y_ASSERTOR_MODEL ?? null,
};

serveStdio(() => createServer(api, assertor));
