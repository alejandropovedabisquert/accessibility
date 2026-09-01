import app from './app';
import config from './config/config';
import { closeDb, getDb } from './db/client';
import repository from './db/audit.repository';
import browserPool from './services/scanner/browserPool';
import auditService from './services/audit/audit.service';

getDb();

// Un reinicio deja auditorias colgadas en 'queued'/'running' para siempre,
// porque la cola vive en memoria. Las cerramos como fallidas al arrancar.
const recovered = repository.recoverInterrupted(new Date().toISOString());
if (recovered > 0) {
  console.warn(`[startup] ${recovered} auditoria(s) interrumpida(s) marcadas como fallidas`);
}

const server = app.listen(config.port, () => {
  console.log(`API de accesibilidad escuchando en http://localhost:${config.port}`);
  console.log(`  datos:     ${config.dataDir}`);
  console.log(`  resultados:${config.resultsDir}`);
});

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] cerrando...`);

  server.close();
  // Damos un margen a los escaneos en vuelo para que dejen la BD consistente.
  await Promise.race([
    auditService.drain(),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  await browserPool.closeAll();
  closeDb();

  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
