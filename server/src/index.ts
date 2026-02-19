import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { authRoutes } from './api/routes/auth.routes.js';
import { researchRoutes } from './api/routes/research.routes.js';
import { chatRoutes } from './api/routes/chat.routes.js';
import { healthRoutes } from './api/routes/health.routes.js';
import { gradientRoutes } from './api/routes/gradient.routes.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

const app = new Elysia()
  .use(cors({
    origin: config.corsOrigin,
    credentials: true,
  }))
  .use(healthRoutes)
  .use(authRoutes)
  .use(researchRoutes)
  .use(chatRoutes)
  .use(gradientRoutes)
  .onError(({ error, set }) => {
    logger.error({ error }, 'Unhandled server error');
    set.status = 500;
    return {
      success: false,
      error: 'Internal server error',
    };
  });

app.listen(config.PORT, () => {
  logger.info(`Server listening at http://localhost:${config.PORT}`);
  logger.info(`Environment: ${config.NODE_ENV}`);
  logger.info(`CORS origins: ${config.corsOrigin.join(', ')}`);
});

export type App = typeof app;
