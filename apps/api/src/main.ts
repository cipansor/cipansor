import { app } from './app';
import { config } from '@/config';
import { assertProductionSecrets } from '@/config/assert-secrets';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  initializeScheduler,
  stopScheduler,
  startWebPushDispatcher,
  stopWebPushDispatcher,
} from '@/jobs';
import { notificationScheduler } from '@/modules/notifications/scheduler.service';
import { redis } from '@/lib/redis';
import { initializeEventBus } from '@/lib/event-bus';
import { createServer } from 'http';

const PORT = config.port;

async function bootstrap() {
  try {
    // Before anything else, and before the port opens. Serving traffic signed
    // by a key published in .env.example is worse than not serving at all.
    assertProductionSecrets();

    // Test database connection
    logger.info('Connecting to database...');
    await prisma.$connect();
    logger.info('Database connected successfully');

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize cross-module event bus
    initializeEventBus();
    logger.info('Event bus initialized');

    // Start server
    httpServer.listen(PORT, () => {
      logger.info(`🚀 Cipansor API running on port ${PORT}`);
      logger.info(`📚 Environment: ${config.env}`);
      logger.info(`🔗 API URL: http://localhost:${PORT}/api`);
      logger.info(`❤️  Health: http://localhost:${PORT}/health`);
    });

    // Initialize scheduled jobs — unless this copy is a staging environment that
    // switched them off (SCHEDULER_ENABLED=false; see config.scheduler).
    if (config.env !== 'test') {
      if (config.scheduler.enabled) {
        initializeScheduler();
        // The notification scheduler (payment reminders, attendance/tahfidz
        // summaries, event reminders, monthly report, budget-overrun alerts) is
        // a second, separate scheduler. Nothing called it before, so none of its
        // tasks ever ran; start it under the same switch.
        notificationScheduler.initialize();
      } else {
        logger.warn(
          '⏸️  Scheduler disabled (SCHEDULER_ENABLED=false): no cron jobs run in this process'
        );
      }
      // Separate from the switch above on purpose — see web-push-dispatch.job.ts.
      startWebPushDispatcher();
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received. Shutting down gracefully...`);

      // Stop scheduled jobs
      stopScheduler();
      stopWebPushDispatcher();
      notificationScheduler.stopAll();

      // Close the Redis connection (dashboard, chatbot and permission caches)
      await redis.quit().catch(() => undefined);

      httpServer.close(async () => {
        logger.info('HTTP server closed');

        await prisma.$disconnect();
        logger.info('Database connection closed');

        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Unhandled errors
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', { promise, reason });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

bootstrap();
