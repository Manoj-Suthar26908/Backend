import { esClient } from '../config/elasticsearch';
import { config } from '../config/env';
import { demoDb, DBEmailJob } from '../config/demo-db';
import { ElasticsearchEmailDoc } from '../types';
import { logger } from '../utils/logger';

export class ElasticsearchService {
  /**
   * Dual-write / index email document into Elasticsearch
   */
  async indexEmail(job: DBEmailJob): Promise<void> {
    const doc: ElasticsearchEmailDoc = {
      id: job.id,
      idempotencyKey: job.idempotencyKey,
      tenantId: job.tenantId,
      userId: job.userId,
      senderAccountId: job.senderAccountId,
      recipient: job.recipient,
      sender: job.metadata?.senderEmail || 'outreach@reachinbox.ethereal.email',
      subject: job.subject,
      body_preview: job.body.slice(0, 300),
      status: job.status,
      scheduled_at: job.scheduledAt,
      sent_at: job.sentAt || null,
      created_at: job.createdAt,
    };

    try {
      await esClient.index({
        index: config.elasticsearch.index,
        id: job.id,
        document: doc,
      });
      logger.debug(`Email ${job.id} indexed into Elasticsearch`);
    } catch (err: any) {
      // Non-fatal if ES is offline in demo mode
      logger.debug(`Elasticsearch index skipped or unavailable (${err.message}). Using local store.`);
    }
  }

  /**
   * Search emails using multi_match query with fallback to local store
   */
  async searchEmails(params: {
    tenantId: string;
    query?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; emails: DBEmailJob[] }> {
    const { tenantId, query, status, limit = 50, offset = 0 } = params;

    // Try Elasticsearch if cluster is responsive
    try {
      const mustClauses: any[] = [{ term: { tenantId } }];

      if (status) {
        mustClauses.push({ term: { status } });
      }

      if (query && query.trim().length > 0) {
        mustClauses.push({
          multi_match: {
            query: query.trim(),
            fields: ['subject^3', 'recipient^2', 'body_preview', 'sender'],
            fuzziness: 'AUTO',
          },
        });
      }

      const esResult = await esClient.search({
        index: config.elasticsearch.index,
        from: offset,
        size: limit,
        query: {
          bool: {
            must: mustClauses,
          },
        },
        sort: [{ scheduled_at: { order: 'desc' } }],
      });

      const hits = esResult.hits.hits;
      const totalHits = typeof esResult.hits.total === 'number' ? esResult.hits.total : esResult.hits.total?.value || 0;

      const jobs: DBEmailJob[] = hits
        .map((hit: any) => demoDb.getEmailJob(hit._id))
        .filter((j): j is DBEmailJob => Boolean(j));

      if (jobs.length > 0 || (query && totalHits === 0)) {
        return {
          total: totalHits,
          emails: jobs,
        };
      }
    } catch (err: any) {
      logger.debug('Elasticsearch search fallback to database search', { error: err.message });
    }

    // Local in-memory full-text search fallback
    let allJobs = demoDb.getEmailJobs({ tenantId });

    if (status) {
      allJobs = allJobs.filter((j) => j.status.toUpperCase() === status.toUpperCase());
    }

    if (query && query.trim().length > 0) {
      const q = query.toLowerCase().trim();
      allJobs = allJobs.filter((j) => {
        return (
          j.subject.toLowerCase().includes(q) ||
          j.recipient.toLowerCase().includes(q) ||
          j.body.toLowerCase().includes(q) ||
          (j.etherealPreviewUrl && j.etherealPreviewUrl.toLowerCase().includes(q))
        );
      });
    }

    // Sort by scheduledAt desc
    allJobs.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

    const total = allJobs.length;
    const paginated = allJobs.slice(offset, offset + limit);

    return {
      total,
      emails: paginated,
    };
  }
}

export const elasticsearchService = new ElasticsearchService();
