import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { LoggerService } from 'src/services/logger/logger.service';

/**
 * Thin wrapper over Resend. In development (or when RESEND_API_KEY is unset) emails are logged to the
 * console instead of sent — so OTP/invite flows work locally without spending real sends. Called only
 * from the email worker.
 */
@Injectable()
export class EmailService {
    private readonly logger = new LoggerService(EmailService.name);
    private readonly resend: Resend | null;
    private readonly from: string;
    private readonly isProd: boolean;

    constructor(private readonly configService: ConfigService) {
        const apiKey = this.configService.get<string>('RESEND_API_KEY');
        this.from =
            this.configService.get<string>('EMAIL_FROM') ??
            'onboarding@resend.dev';
        this.isProd = this.configService.get<string>('NODE_ENV') === 'production';
        this.resend = apiKey ? new Resend(apiKey) : null;
    }

    async send(to: string, subject: string, html: string): Promise<void> {
        // Only actually send in production with a configured key.
        if (!this.isProd || !this.resend) {
            this.logger.log(`[email:dev] not sent → to=${to} · subject="${subject}"`);
            this.logger.debug(html);
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
