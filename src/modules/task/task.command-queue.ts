import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import { TASK_COMMAND_QUEUE } from 'src/config/constants';
import { buildBullConnection } from 'src/services/queue/bull-connection';
import { TaskCommand } from './task.commands';

// Cap how long a write waits for its command to be processed before erroring out.
const COMMAND_TIMEOUT_MS = 15000;

/**
 * Producer for the serialized task pipeline. Enqueues a command and awaits the worker's
 * result via QueueEvents (cross-instance), so callers get the committed task back synchronously.
 */
@Injectable()
export class TaskCommandQueue implements OnModuleInit, OnModuleDestroy {
    private queueEvents!: QueueEvents;

    constructor(
        @InjectQueue(TASK_COMMAND_QUEUE) private readonly queue: Queue,
        private readonly configService: ConfigService,
    ) { }

    async onModuleInit(): Promise<void> {
        this.queueEvents = new QueueEvents(TASK_COMMAND_QUEUE, {
            connection: buildBullConnection(this.configService),
        });
        await this.queueEvents.waitUntilReady();
    }

    async onModuleDestroy(): Promise<void> {
        await this.queueEvents?.close();
    }

    /** Enqueue a command and resolve with the worker's return value (the committed task). */
    async dispatch<T = any>(command: TaskCommand): Promise<T> {
        const job = await this.queue.add(command.type, command, {
            attempts: 1, // commands are not idempotent; don't auto-retry a partial apply
            removeOnComplete: true,
            removeOnFail: 100,
        });
        return job.waitUntilFinished(this.queueEvents, COMMAND_TIMEOUT_MS) as Promise<T>;
    }
}
