import { Elysia, t } from 'elysia';
import { eq, desc, ilike, or, sql } from 'drizzle-orm';
import { researchService } from '../../services/research.service.js';
import { getDb } from '../../db/connection.js';
import { researchJobs } from '../../db/schema.js';
import { authMacro } from '../../plugins/better-auth.plugin.js';
import { clampedInt } from '../../utils/query-helpers.js';

const CreateResearchSchema = t.Object({
  query: t.String({ minLength: 1 }),
  context: t.Optional(t.String()),
  focusAreas: t.Optional(t.Array(t.String())),
  maxResults: t.Optional(t.Number()),
  useGradientNative: t.Optional(t.Boolean()),
});

export const researchRoutes = new Elysia({ prefix: '/api/research' })
  .use(authMacro)
  .post('/', async ({ body, set, user }) => {
    const job = await researchService.createResearchJob({
      userId: user.id,
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
    auth: true,
    body: CreateResearchSchema,
  })

  .get('/', async ({ query, user }) => {
    const db = getDb();
    const limit = clampedInt(query?.limit, 50, 1, 100);
    const offset = clampedInt(query?.offset, 0, 0, 10000);

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
      .where(eq(researchJobs.userId, user.id))
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
  }, { auth: true })

  .get('/search', async ({ query, set, user }) => {
    const q = (query as Record<string, string | undefined>).q;
    if (!q) {
      set.status = 400;
      return { success: false, error: 'Query parameter "q" is required' };
    }

    const db = getDb();
    const limit = clampedInt((query as Record<string, string | undefined>).limit, 10, 1, 100);

    const escapedQ = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escapedQ}%`;

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
      .where(sql`${researchJobs.userId} = ${user.id} AND (${researchJobs.query} ILIKE ${pattern} OR ${researchJobs.result}::text ILIKE ${pattern})`)
      .orderBy(desc(researchJobs.createdAt))
      .limit(limit);

    return {
      success: true,
      data: jobs.map((r) => ({
        jobId: r.id,
        query: r.query,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        hasResult: !!r.result,
      })),
    };
  }, { auth: true })

  .get('/:jobId', async ({ params, set, user }) => {
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

    if (!job || job.userId !== user.id) {
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
  }, { auth: true })

  .get('/:jobId/report', async ({ params, set, user }) => {
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

    if (!job || job.userId !== user.id || !job.result) {
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
  }, { auth: true });
