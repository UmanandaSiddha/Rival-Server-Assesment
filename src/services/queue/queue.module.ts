import { BullModule } from '@nestjs/bullmq';
import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BACKFILL_QUEUE, EMAIL_QUEUE, INJESTION_QUEUE, LLM_QUEUE, WEBHOOK_QUEUE, WRITEBACK_QUEUE, REPORT_QUEUE } from 'src/config/constants';
import { IngestionQueue } from './ingestion.queue';
import { WebhookQueue } from './webhook.queue';
import { LLMQueue } from './llm.queue';
import { EmailQueue } from './email.queue';
import { IngestionProcessor } from './processors/ingestion.processor';
import { WebhookProcessor } from './processors/webhook.processor';
import { LLMProcessor } from './processors/llm.processor';
import { EmailProcessor } from './processors/email.processor';
import { CreditExpiryProcessor } from './processors/credit-expiry.processor';
import { NotificationProcessor } from './processors/notification.processor';
import { WritebackQueue } from './writeback.queue';
import { WritebackProcessor } from './processors/writeback.processor';
import { WritebackExecutorService } from 'src/modules/writebacks/writeback-executor.service';
import { ReportQueue } from './report.queue';
import { ReportProcessor } from './processors/report.processor';
import { BackfillQueue } from './backfill.queue';
import { BackfillProcessor } from './processors/backfill.processor';
import { JobRecoveryService } from './job-recovery.service';
import { WritebackRecoveryService } from './writeback-recovery.service';
import { NotificationRecoveryService } from './notification-recovery.service';
import { WebhookRecoveryService } from './webhook-recovery.service';
import { OutboundModule } from 'src/services/outbound/outbound.module';
import { LoggerModule } from '../logger/logger.module';
import { DatabaseModule } from '../database/database.module';
import { LlmModule } from '../../modules/llm/llm.module';
import { AgentOrchestratorModule } from '../../modules/agent-orchestrator/agent-orchestrator.module';
import { ChatModule } from '../../modules/chat/chat.module';
import { NangoModule } from '../../modules/nango/nango.module';
import { ConnectionOptions } from 'bullmq';

@Global()
@Module({
    imports: [
        ConfigModule,
        LoggerModule,
        DatabaseModule,
        forwardRef(() => LlmModule),
        forwardRef(() => AgentOrchestratorModule),
        forwardRef(() => ChatModule),
        OutboundModule,
        forwardRef(() => NangoModule),
        BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const tlsEnabled = ['true', '1', 'yes'].includes(
                    String(configService.get<string>('REDIS_TLS_ENABLED') ?? process.env.REDIS_TLS_ENABLED ?? '').toLowerCase()
                );
                const portRaw = configService.get<string>('REDIS_PORT') ?? process.env.REDIS_PORT ?? '6379';
                const port = parseInt(String(portRaw), 10) || 6379;
                const connectionConfig: ConnectionOptions = {
                    host: configService.get<string>('REDIS_HOST') ?? process.env.REDIS_HOST,
                    port,
                    retryDelayOnFailover: 100,
                    connectTimeout: 10000,
                    lazyConnect: false,
                    maxRetriesPerRequest: null,
                    ...(tlsEnabled && { tls: { rejectUnauthorized: false } }),
                    retryStrategy: (times: number) => {
                        const delay = Math.min(times * 2000, 30000);
                        console.log(`BullMQ Redis retry attempt ${times}, delay: ${delay}ms`);
                        return delay;
                    },
                    enableReadyCheck: true,
                    keepAlive: 30000,
                    reconnectOnError: (err: Error) => {
                        const targetErrors = [
                            'READONLY',
                            'ECONNRESET',
                            'ENOTFOUND',
                            'ETIMEDOUT',
                            'Socket closed unexpectedly'
                        ];
                        console.error('BullMQ Redis error:', err.message);
                        return targetErrors.some(targetError => err.message.includes(targetError)) ? 1 : false;
                    },
                };

                console.log('BullMQ Redis configuration applied');

                return {
                    connection: connectionConfig,
                    defaultJobOptions: {
                        removeOnComplete: 50,
                        removeOnFail: 20,
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 2000,
                        },
                    },
                };
            },
        }),
        BullModule.registerQueue(
            {
                name: INJESTION_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: WEBHOOK_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: LLM_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: EMAIL_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: 'CREDIT_EXPIRY',
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: 'NOTIFICATION',
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: WRITEBACK_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: REPORT_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
            {
                name: BACKFILL_QUEUE,
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                }
            },
        ),
    ],
    providers: [
        IngestionQueue,
        WebhookQueue,
        LLMQueue,
        EmailQueue,
        IngestionProcessor,
        WebhookProcessor,
        LLMProcessor,
        EmailProcessor,
        CreditExpiryProcessor,
        NotificationProcessor,
        WritebackQueue,
        WritebackProcessor,
        WritebackExecutorService,
        ReportQueue,
        ReportProcessor,
        BackfillQueue,
        BackfillProcessor,
        JobRecoveryService,
        WritebackRecoveryService,
        NotificationRecoveryService,
        WebhookRecoveryService,
    ],
    exports: [
        BullModule,
        IngestionQueue,
        WebhookQueue,
        LLMQueue,
        EmailQueue,
        WritebackQueue,
        ReportQueue,
        BackfillQueue,
        JobRecoveryService,
        WritebackRecoveryService,
        NotificationRecoveryService,
        WebhookRecoveryService,
    ],
})
export class QueueModule { }