import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line no-var
  var prismaClientGlobal: PrismaClient | undefined;
}

export const prisma =
  global.prismaClientGlobal ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.prismaClientGlobal = prisma;
}

export async function connectPrisma(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected successfully via Prisma');
  } catch (error) {
    logger.error('Failed to connect to PostgreSQL via Prisma', { error });
    throw error;
  }
}
