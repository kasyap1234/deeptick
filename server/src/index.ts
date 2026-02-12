import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { researchRoutes } from './api/routes/research.routes.js';
import { enhancedChatRoutes } from './api/routes/enhanced-chat.routes.js';
import { healthRoutes } from './api/routes/health.routes.js';
import { researchWebSocket } from './api/websocket/research.ws.js';
import { chatWebSocket } from './api/websocket/chat.ws.js';
import { config } from './config/index.js';

const app = new Elysia()
  .use(cors({
    origin: config.corsOrigin,
    credentials: true,
  }))
  .use(healthRoutes)
  .use(researchRoutes)
  .use(enhancedChatRoutes)
  .use(researchWebSocket)
  .use(chatWebSocket)
  .onError(({ error, set }) => {
    console.error('Error:', error);
    set.status = 500;
    return {
      success: false,
      error: 'Internal server error',
    };
  });

app.listen(config.PORT, () => {
  console.log(`Server listening at http://localhost:${config.PORT}`);
  console.log(`Environment: ${config.NODE_ENV}`);
  console.log(`CORS origins: ${config.corsOrigin.join(', ')}`);
});

export type App = typeof app;
