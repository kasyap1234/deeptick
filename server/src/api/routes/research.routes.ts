import { Elysia, t } from 'elysia';
import { eq, desc } from 'drizzle-orm';
import { researchService } from '../../services/research.service.js';
import { getDb } from '../../db/connection.js';
import { researchJobs } from '../../db/schema.js';
import { authMiddleware } from '../../middleware/auth.js';

const CreateResearchSchema = t.Object({
  query: t.String({ minLength: 1 }),
  context: t.Optional(t.String()),
  focusAreas: t.Optional(t.Array(t.String())),
  maxResults: t.Optional(t.Number()),
  useGradientNative: t.Optional(t.Boolean()),
});

export const researchRoutes = new Elysia({ prefix: '/api/research' })
  .post('/', async ({ body, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const job = await researchService.createResearchJob({
      userId: authResult.userId,
      query: body.query,
      context: body.context,
      focusAreas: body.focusAreas,
      maxResults: body.maxResults,
    });

    set.status = 202;
    return {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        query: job.query,
        createdAt: job.createdAt,
      },
    };
  }, {
    body: CreateResearchSchema,
  })

  .get('/', async ({ query, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    const limit = parseInt(query?.limit ?? '50');
    const offset = parseInt(query?.offset ?? '0');
    
    const jobs = await db
      .select({
        id: researchJobs.id,
        query: researchJobs.query,
        status: researchJobs.status,
        createdAt: researchJobs.createdAt,
        updatedAt: researchJobs.updatedAt,
        result: researchJobs.result,
      })
      .from(researchJobs)
      .where(eq(researchJobs.userId, authResult.userId))
      .orderBy(desc(researchJobs.createdAt))
      .limit(limit)
      .offset(offset);
    
    return {
      success: true,
      data: jobs.map((job) => ({
        jobId: job.id,
        status: job.status,
        query: job.query,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        hasResult: !!job.result,
      })),
    };
  })

  .get('/search', async ({ query, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const q = (query as Record<string, string | undefined>).q;
    if (!q) {
      set.status = 400;
      return { success: false, error: 'Query parameter "q" is required' };
    }

    const db = getDb();
    const limit = parseInt((query as Record<string, string | undefined>).limit ?? '10');

    const jobs = await db
      .select({
        id: researchJobs.id,
        query: researchJobs.query,
        status: researchJobs.status,
        result: researchJobs.result,
        createdAt: researchJobs.createdAt,
        updatedAt: researchJobs.updatedAt,
      })
      .from(researchJobs)
      .where(eq(researchJobs.userId, authResult.userId))
      .orderBy(desc(researchJobs.createdAt))
      .limit(limit);

    const searchLower = q.toLowerCase();
    const filtered = jobs.filter(job => 
      job.query.toLowerCase().includes(searchLower) ||
      (job.result && JSON.stringify(job.result).toLowerCase().includes(searchLower))
    );

    return {
      success: true,
      data: filtered.map((r) => ({
        jobId: r.id,
        query: r.query,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        hasResult: !!r.result,
      })),
    };
  })

  .get('/:jobId', async ({ params, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    const [job] = await db
      .select({
        id: researchJobs.id,
        query: researchJobs.query,
        status: researchJobs.status,
        result: researchJobs.result,
        metadata: researchJobs.metadata,
        error: researchJobs.error,
        createdAt: researchJobs.createdAt,
        updatedAt: researchJobs.updatedAt,
        userId: researchJobs.userId,
      })
      .from(researchJobs)
      .where(eq(researchJobs.id, params.jobId))
      .limit(1);

    if (!job || job.userId !== authResult.userId) {
      set.status = 404;
      return { success: false, error: 'Research job not found' };
    }

    return {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        query: job.query,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        result: job.result,
        error: job.error,
        metadata: job.metadata,
      },
    };
  })

  .get('/:jobId/report', async ({ params, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    const [job] = await db
      .select({
        id: researchJobs.id,
        query: researchJobs.query,
        result: researchJobs.result,
        createdAt: researchJobs.createdAt,
        userId: researchJobs.userId,
      })
      .from(researchJobs)
      .where(eq(researchJobs.id, params.jobId))
      .limit(1);

    if (!job || job.userId !== authResult.userId || !job.result) {
      set.status = 404;
      return { success: false, error: 'Research report not found' };
    }

    return {
      success: true,
      data: {
        jobId: job.id,
        query: job.query,
        createdAt: job.createdAt,
        report: job.result,
      },
    };
  });
