import './polyfills/typebox-module.polyfill.js';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { betterAuthPlugin, authMacro } from './plugins/better-auth.plugin.js';
import { researchRoutes } from './api/routes/research.routes.js';
import { chatRoutes } from './api/routes/chat.routes.js';
import { healthRoutes } from './api/routes/health.routes.js';
import { gradientRoutes } from './api/routes/gradient.routes.js';
import { researchWebSocket } from './api/websocket/research.ws.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { toApiError } from './utils/api-error.js';

export function createApp() {
  return new Elysia()
    .use(cors({
      origin: config.corsOrigin,
      credentials: true,
    }))
    .use(betterAuthPlugin)
    .use(authMacro)
    .use(healthRoutes)
    .use(researchRoutes)
    .use(chatRoutes)
    .use(gradientRoutes)
    .use(researchWebSocket)
    .onError(({ error, set }) => {
      logger.error({ error }, 'Unhandled server error');
      const { status, body } = toApiError(error, 'Internal server error');
      set.status = status;
      return body;
    });
}

import { gradientCacheService } from './services/gradient-cache.service.js';

const app = createApp();

if (import.meta.main) {
  app.listen(config.PORT, () => {
    logger.info(`Server listening at http://localhost:${config.PORT}`);
    logger.info(`Environment: ${config.NODE_ENV}`);
    logger.info(`CORS origins: ${config.corsOrigin.join(', ')}`);

    // Initialize Gradient Cache asynchronously — not blocking server startup
    if (config.isUsingGradient) {
      gradientCacheService.initialize().catch((err) => {
        logger.warn({ error: err }, 'Gradient Cache Service initialization failed (non-fatal)');
      });
    }
  });
}

export type App = ReturnType<typeof createApp>;
