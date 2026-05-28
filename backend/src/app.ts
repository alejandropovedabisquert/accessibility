import express from 'express';
import { errorHandler } from './middlewares/errorHandler';
import generalRoutes from './routes/general.routes';

const BASE_API_PATH = '/api';
const app = express();

app.use(express.json());

// Routes
app.use(`${BASE_API_PATH}/accessibility`, generalRoutes);
app.get('/', (req, res) => {
  res.json({ message: 'Hello, World!' });
});
// Global error handler (should be after routes)
app.use(errorHandler);

export default app;