import { Client } from '@elastic/elasticsearch';
import { config } from './env';
import { logger } from '../utils/logger';

export const esClient = new Client({
  node: config.elasticsearch.node,
});

export async function initElasticsearch(): Promise<void> {
  try {
    const health = await esClient.cluster.health();
    logger.info(`Elasticsearch connected successfully, cluster status: ${health.status}`);

    const indexExists = await esClient.indices.exists({
      index: config.elasticsearch.index,
    });

    if (!indexExists) {
      await esClient.indices.create({
        index: config.elasticsearch.index,
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              idempotencyKey: { type: 'keyword' },
              tenantId: { type: 'keyword' },
              userId: { type: 'keyword' },
              senderAccountId: { type: 'keyword' },
              recipient: { type: 'keyword' },
              sender: { type: 'keyword' },
              subject: { type: 'text', analyzer: 'standard' },
              body_preview: { type: 'text', analyzer: 'standard' },
              status: { type: 'keyword' },
              scheduled_at: { type: 'date' },
              sent_at: { type: 'date' },
              created_at: { type: 'date' },
            },
          },
        },
      });
      logger.info(`Elasticsearch index '${config.elasticsearch.index}' initialized successfully`);
    } else {
      logger.info(`Elasticsearch index '${config.elasticsearch.index}' already exists`);
    }
  } catch (error: any) {
    logger.warn('Elasticsearch initialization warning (will retry on demand)', { error: error.message });
  }
}
