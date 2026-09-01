import express from 'express';
import cors from 'cors';
import config from './config/config';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
