import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EMAIL_QUEUE } from 'src/config/constants';
import { LoggerService } from 'src/services/logger/logger.service';
import { EmailService } from './email.service';
import { EmailJobPayload } from './email.queue';
import { renderEmail } from './email.templates';
import { EmailTemplate } from './email.types';

/**
 * Email queue worker. Renders the template and sends via Resend.
 * Throwing lets BullMQ retry per the producer's backoff policy.
 */
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
    private readonly logger = new LoggerService(EmailProcessor.name);

    constructor(private readonly emailService: EmailService) {
        super();
    }

    async process(job: Job<EmailJobPayload>): Promise<void> {
        const { to, subject, template, data } = job.data;
        const html = renderEmail(template as EmailTemplate, data ?? {});
        await this.emailService.send(to, subject, html);
        this.logger.log(`Sent "${template}" email to ${to}`);
    }
}
