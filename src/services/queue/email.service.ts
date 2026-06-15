import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { LoggerService } from 'src/services/logger/logger.service';

/**
 * Thin wrapper over Resend. If RESEND_API_KEY is unset (local dev), it logs instead of sending so
 * the OTP/invite flows still work without an email provider. Called only from the email worker.
 */
@Injectable()
export class EmailService {
    private readonly logger = new LoggerService(EmailService.name);
    private readonly resend: Resend | null;
    private readonly from: string;

    constructor(private readonly configService: ConfigService) {
        const apiKey = this.configService.get<string>('RESEND_API_KEY');
        this.from =
            this.configService.get<string>('EMAIL_FROM') ??
            'onboarding@resend.dev';
        this.resend = apiKey ? new Resend(apiKey) : null;
    }

    async send(to: string, subject: string, html: string): Promise<void> {
        if (!this.resend) {
            this.logger.warn(
                `RESEND_API_KEY not set — skipping email to ${to} ("${subject}")`,
            );
            return;
        }

        const { error } = await this.resend.emails.send({
            from: this.from,
            to,
            subject,
            html,
        });
        if (error) {
            // Throw so BullMQ retries the job per its backoff policy.
            throw new Error(`Resend failed for ${to}: ${error.message}`);
        }
    }
}
