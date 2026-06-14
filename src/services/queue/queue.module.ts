import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EMAIL_QUEUE } from 'src/config/constants';
import { buildBullConnection } from './bull-connection';
import { EmailQueue } from './email.queue';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';

/**
 * BullMQ root + the email queue. Uses its own Redis connection — BullMQ needs
 * maxRetriesPerRequest: null for its blocking workers, unlike the app's REDIS_CLIENT.
 * Global so any feature module can inject EmailQueue without re-importing.
 */
@Global()
@Module({
    imports: [
        ConfigModule,
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
        BullModule.registerQueue({ name: EMAIL_QUEUE }),
    ],
    providers: [EmailQueue, EmailService, EmailProcessor],
    exports: [EmailQueue, BullModule],
})
export class QueueModule { }
