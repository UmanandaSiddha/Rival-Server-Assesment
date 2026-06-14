import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE } from 'src/config/constants';

export interface EmailJobPayload {
    to: string;
    subject: string;
    template: string;
    data?: any;
}

@Injectable()
export class EmailQueue {
    constructor(
        @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue,
    ) { }

    async enqueue(job: EmailJobPayload) {
        return this.queue.add('send_email', job, {
            priority: 4,
        });
    }
}