import { Elysia, t } from 'elysia';
import { eq, desc, sql, and, gt } from 'drizzle-orm';
import { researchService } from '../../services/research.service.js';
import { embeddingService } from '../../services/embedding.service.js';
import { db } from '../../db/connection.js';
import { researchJobs } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';

const CreateResearchSchema = t.Object({
  query: t.String({ minLength: 1 }),
  context: t.Optional(t.String()),
  focusAreas: t.Optional(t.Array(t.String())),
  maxResults: t.Optional(t.Number()),
});

export const researchRoutes = new Elysia({ prefix: '/api/research' })
  .post('/', async ({ body, set }) => {
    const job = await researchService.createResearchJob({
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

  .get('/', async ({ query }) => {
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

  .get('/search', async ({ query, set }) => {
    if (!query?.q) {
      set.status = 400;
      return {
        success: false,
        error: 'Query parameter "q" is required',
      };
    }

    const searchQuery = query.q;
    const limit = parseInt(query?.limit ?? '10');
    const threshold = parseFloat(query?.threshold ?? '0.7');

    try {
      const embedding = await embeddingService.embedQuery(searchQuery);
      const similarity = sql<number>`1 - (${researchJobs.queryEmbedding} <=> ${embedding}::vector)`;

      const results = await db
        .select({
          id: researchJobs.id,
          query: researchJobs.query,
          status: researchJobs.status,
          result: researchJobs.result,
          createdAt: researchJobs.createdAt,
          updatedAt: researchJobs.updatedAt,
          similarity,
        })
        .from(researchJobs)
        .where(and(
          gt(similarity, threshold),
          sql`${researchJobs.status} = 'completed'`
        ))
        .orderBy(desc(similarity))
        .limit(limit);

      return {
        success: true,
        data: results.map((r) => ({
          jobId: r.id,
          query: r.query,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          similarity: r.similarity,
          hasResult: !!r.result,
        })),
      };
    } catch (error) {
      logger.error({ error }, 'Error searching research');
      set.status = 500;
      return {
        success: false,
        error: 'Failed to search research history',
      };
    }
  })

  .get('/:jobId', async ({ params, set }) => {
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
      })
      .from(researchJobs)
      .where(eq(researchJobs.id, params.jobId))
      .limit(1);

    if (!job) {
      const memoryJob = researchService.getJob(params.jobId);
      if (memoryJob) {
        return {
          success: true,
          data: {
            jobId: memoryJob.id,
            status: memoryJob.status,
            query: memoryJob.query,
            createdAt: memoryJob.createdAt,
            updatedAt: memoryJob.updatedAt,
            result: memoryJob.result,
            error: memoryJob.error,
            metadata: memoryJob.metadata,
          },
        };
      }
      
      set.status = 404;
      return {
        success: false,
        error: 'Research job not found',
      };
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

  .get('/:jobId/report', async ({ params, set }) => {
    const [job] = await db
      .select({
        id: researchJobs.id,
        query: researchJobs.query,
        result: researchJobs.result,
        createdAt: researchJobs.createdAt,
      })
      .from(researchJobs)
      .where(eq(researchJobs.id, params.jobId))
      .limit(1);

    if (!job || !job.result) {
      set.status = 404;
      return {
        success: false,
        error: 'Research report not found',
      };
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
