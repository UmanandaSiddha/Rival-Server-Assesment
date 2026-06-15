import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_QUEUE, TASK_COMMAND_QUEUE } from 'src/config/constants';
import { RealtimeModule } from 'src/modules/realtime/realtime.module';
import { buildBullConnection } from './bull-connection';
import { EmailQueue } from './email.queue';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { TaskCommandQueue } from './task-command.queue';
import { TaskProcessor } from './task.processor';

/**
 * Central BullMQ module: the Redis connection + every queue, producer, and worker.
 * Uses its own connection — BullMQ needs maxRetriesPerRequest: null for blocking workers.
 * Global so any feature module can inject a producer (EmailQueue, TaskCommandQueue) without re-importing.
 */
@Global()
@Module({
    imports: [
        ConfigModule,
        RealtimeModule, // TaskProcessor broadcasts via RealtimePublisher after a commit
        BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                connection: buildBullConnection(configService),
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 },
                },
            }),
        }),
        BullModule.registerQueue(
            { name: EMAIL_QUEUE },
            { name: TASK_COMMAND_QUEUE },
        ),
    ],
    providers: [
        EmailQueue,
        EmailService,
        EmailProcessor,
        TaskCommandQueue,
        TaskProcessor,
    ],
    exports: [EmailQueue, TaskCommandQueue, BullModule],
})
export class QueueModule {}
