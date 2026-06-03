import express from 'express';
import { errorHandler } from './middlewares/errorHandler';
import generalRoutes from './routes/general.routes';

const BASE_API_PATH = '/api';
const app = express();

app.use(express.json());

// Routes
app.use(`${BASE_API_PATH}/accessibility`, generalRoutes);
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
// Global error handler (should be after routes)
app.use(errorHandler);

export default app;