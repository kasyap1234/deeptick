import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { researchRoutes } from './api/routes/research.routes.js';
import { enhancedChatRoutes } from './api/routes/enhanced-chat.routes.js';
import { healthRoutes } from './api/routes/health.routes.js';
import { gradientRoutes } from './api/routes/gradient.routes.js';
import { researchWebSocket } from './api/websocket/research.ws.js';
import { chatWebSocket } from './api/websocket/chat.ws.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

const app = new Elysia()
  .use(cors({
    origin: config.corsOrigin,
    credentials: true,
  }))
  .use(healthRoutes)
  .use(researchRoutes)
  .use(enhancedChatRoutes)
  .use(gradientRoutes)
  .use(researchWebSocket)
  .use(chatWebSocket)
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
