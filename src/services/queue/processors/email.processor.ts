import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { EMAIL_QUEUE } from 'src/config/constants';
import { EmailJobPayload } from '../email.queue';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from 'src/services/logger/logger.service';
import { Resend } from 'resend';
import { Job } from 'bullmq';

@Injectable()
@Processor(EMAIL_QUEUE, { concurrency: parseInt(process.env.EMAIL_QUEUE_CONCURRENCY ?? '5', 10) || 5 })
export class EmailProcessor extends WorkerHost {
    private readonly logger = new LoggerService(EmailProcessor.name);
    private readonly resendClient: Resend;
    private readonly fromEmail: string;
    private readonly nodeEnv: string;
    private readonly resendApiKey: string;

    constructor(private readonly configService: ConfigService) {
        super();

        this.nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
        this.fromEmail = this.configService.get<string>('AWS_SES_FROM_EMAIL') || 'no-reply@ovlox.dev';
        this.resendApiKey = this.configService.get<string>('RESEND_API_KEY');

        // Initialize Resend for staging and production
        if (this.nodeEnv !== 'development') {
            if (!this.resendApiKey) {
                this.logger.error(
                    `Resend API key not configured for ${this.nodeEnv} environment. Email sending will fail.`,
                    EmailProcessor.name
                );
            }
            this.resendClient = this.resendApiKey ? new Resend(this.resendApiKey) : null;
        } else {
            this.logger.log('Development mode: Emails will be logged to console instead of sent', EmailProcessor.name);
        }
    }

    async process(job: Job<EmailJobPayload>) {
        const data = job.data;

        this.logger.log(`Processing email to ${data.to}: ${data.subject}`, EmailProcessor.name);

        // In development, console log and don't send
        if (this.nodeEnv === 'development') {
            this.logger.log(
                `[DEV] Email: To=${data.to}, Subject=${data.subject}, Template=${data.template}`,
                EmailProcessor.name
            );
            console.log('\n');
            console.log('='.repeat(80));
            console.log('[DEV EMAIL] - NOT SENDING IN DEVELOPMENT');
            console.log('='.repeat(80));
            console.log(`To: ${data.to}`);
            console.log(`Subject: ${data.subject}`);
            console.log(`Template: ${data.template}`);
            if (data.data) {
                console.log(`Data:`, JSON.stringify(data.data, null, 2));
            }
            console.log('='.repeat(80));
            console.log('\n');
            return true;
        }

        // In staging and production, send via Resend
        try {
            return await this.sendViaResend(data);
        } catch (resendError) {
            this.logger.error(
                `Failed to send email to ${data.to}. Error: ${resendError.message}`,
                EmailProcessor.name
            );
            throw new Error(`Email delivery failed: ${resendError.message}`);
        }
    }

    /**
     * Send email via Resend
     * Primary provider for staging and production environments
     */
    private async sendViaResend(data: EmailJobPayload): Promise<boolean> {
        if (!this.resendClient) {
            throw new Error('Resend client not initialized. RESEND_API_KEY not configured.');
        }

        try {
            const htmlContent = this.renderEmailTemplate(data.template || 'default', data.data);
            const textContent = this.renderEmailText(data.template || 'default', data.data);

            const response = await this.resendClient.emails.send({
                from: this.fromEmail,
                to: data.to,
                subject: data.subject || 'Notification',
                html: htmlContent,
                text: textContent,
            });

            if (response.error) {
                throw new Error(`Resend error: ${response.error.message}`);
            }

            this.logger.log(
                `Email sent via Resend to ${data.to}: ${data.subject} (Message ID: ${response.data?.id})`,
                EmailProcessor.name
            );
            return true;
        } catch (error) {
            this.logger.error(
                `Resend send failed for ${data.to}: ${error.message}`,
                EmailProcessor.name
            );
            throw error;
        }
    }

    /**
     * Render email HTML template
     */
    private renderEmailTemplate(template: string, data: any = {}): string {
        const baseStyle = `
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
                line-height: 1.6;
                color: #333;
            }
            .container {
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
            }
            .header {
                background-color: #f8f9fa;
                padding: 20px;
                border-radius: 4px;
                margin-bottom: 20px;
            }
            .content {
                margin: 20px 0;
            }
            .footer {
                color: #666;
                font-size: 12px;
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
            }
            .button {
                display: inline-block;
                background-color: #007bff;
                color: white;
                padding: 10px 20px;
                text-decoration: none;
                border-radius: 4px;
                margin: 10px 0;
            }
            .invoice-table {
                width: 100%;
                border-collapse: collapse;
                margin: 20px 0;
            }
            .invoice-table th, .invoice-table td {
                padding: 10px;
                text-align: left;
                border-bottom: 1px solid #ddd;
            }
            .invoice-table th {
                background-color: #f8f9fa;
                font-weight: 600;
            }
            .text-right {
                text-align: right;
            }
            .total-row {
                font-weight: 600;
                background-color: #f8f9fa;
            }
        `;

        switch (template) {
            case 'otp':
                return `
                    <html>
                    <head><style>${baseStyle}</style></head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h2>Your verification code</h2>
                            </div>
                            <div class="content">
                                <p>Hello ${data.firstName || 'there'},</p>
                                <p>${data.message || 'Use the one-time password below to verify your account.'}</p>
                                <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 16px 0;">${data.otpCode || ''}</p>
                                <p>This code expires in ${data.expiresInMinutes || 5} minutes.</p>
                            </div>
                            <div class="footer">
                                <p>If you did not request this code, you can safely ignore this email.</p>
                                <p>© Ovlox. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `;

            case 'invite':
                return `
                    <html>
                    <head><style>${baseStyle}</style></head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h2>You've been invited to join an organization!</h2>
                            </div>
                            <div class="content">
                                <p>Hello ${data.firstName || 'there'},</p>
                                <p>${data.message || 'You have been invited to join an organization on Ovlox. Click the link below to accept the invitation.'}</p>
                                <a href="${data.inviteUrl}" class="button">Accept Invitation</a>
                                <p style="margin-top: 20px;">If you didn't expect this invitation, you can safely ignore this email.</p>
                            </div>
                            <div class="footer">
                                <p>© Ovlox. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `;

            case 'welcome':
                return `
                    <html>
                    <head><style>${baseStyle}</style></head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h2>Welcome to Ovlox!</h2>
                            </div>
                            <div class="content">
                                <p>Hello ${data.firstName || 'there'},</p>
                                <p>${data.message || 'Thank you for joining Ovlox. We\'re excited to have you on board.'}</p>
                            </div>
                            <div class="footer">
                                <p>© Ovlox. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `;

            case 'invoice':
                return `
                    <html>
                    <head><style>${baseStyle}</style></head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h2>Invoice #${data.invoiceNumber}</h2>
                                <p>Organization: ${data.organizationName}</p>
                            </div>
                            <div class="content">
                                <p>Hello ${data.firstName || 'there'},</p>
                                <p>Please find attached your invoice for services rendered.</p>
                                
                                <h3>Invoice Details</h3>
                                <table class="invoice-table">
                                    <thead>
                                        <tr>
                                            <th>Description</th>
                                            <th class="text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${data.lineItems && data.lineItems.length > 0 ? data.lineItems.map((item: any) => `
                                            <tr>
                                                <td>${item.description}</td>
                                                <td class="text-right">$${parseFloat(item.amount || 0).toFixed(2)}</td>
                                            </tr>
                                        `).join('') : '<tr><td colspan="2">No line items</td></tr>'}
                                        <tr class="total-row">
                                            <td>Total Due</td>
                                            <td class="text-right">$${parseFloat(data.totalAmount || 0).toFixed(2)}</td>
                                        </tr>
                                    </tbody>
                                </table>

                                <p><strong>Due Date:</strong> ${data.dueDate || 'Not specified'}</p>
                                <p><strong>Status:</strong> ${data.status || 'Pending'}</p>

                                ${data.invoiceUrl ? `<a href="${data.invoiceUrl}" class="button">View Full Invoice</a>` : ''}
                            </div>
                            <div class="footer">
                                <p>If you have any questions about this invoice, please contact our billing team.</p>
                                <p>© Ovlox. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `;

            case 'notification':
            default:
                return `
                    <html>
                    <head><style>${baseStyle}</style></head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h2>${data.title || 'Notification'}</h2>
                            </div>
                            <div class="content">
                                <p>Hello ${data.firstName || 'there'},</p>
                                <p>${data.message || data.content || 'You have a new notification.'}</p>
                                ${data.actionUrl ? `<a href="${data.actionUrl}" class="button">View Details</a>` : ''}
                            </div>
                            <div class="footer">
                                <p>© Ovlox. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `;
        }
    }

    /**
     * Render email text content (plain text fallback)
     */
    private renderEmailText(template: string, data: any = {}): string {
        switch (template) {
            case 'otp':
                return `Hello ${data.firstName || 'there'},\n\n${data.message || 'Use this one-time password to verify your account.'}\n\nCode: ${data.otpCode || ''}\nExpires in: ${data.expiresInMinutes || 5} minutes\n\nIf you did not request this code, you can safely ignore this email.`;

            case 'invite':
                return `${data.message || 'You have been invited to join an organization.'}\n\nAccept here: ${data.inviteUrl}\n\nIf you didn't expect this invitation, you can safely ignore this email.`;

            case 'welcome':
                return `Hello ${data.firstName || 'there'},\n\n${data.message || 'Thank you for joining Ovlox. We\'re excited to have you on board.'}\n\n© Ovlox. All rights reserved.`;

            case 'invoice':
                let text = `Invoice #${data.invoiceNumber}\nOrganization: ${data.organizationName}\n\n`;
                text += `Hello ${data.firstName || 'there'},\n\nPlease find your invoice details below:\n\n`;
                text += `INVOICE DETAILS:\n`;
                text += `${'-'.repeat(40)}\n`;
                if (data.lineItems && data.lineItems.length > 0) {
                    data.lineItems.forEach((item: any) => {
                        text += `${item.description}: $${parseFloat(item.amount || 0).toFixed(2)}\n`;
                    });
                }
                text += `${'-'.repeat(40)}\n`;
                text += `Total Due: $${parseFloat(data.totalAmount || 0).toFixed(2)}\n`;
                text += `Due Date: ${data.dueDate || 'Not specified'}\n`;
                text += `Status: ${data.status || 'Pending'}\n\n`;
                if (data.invoiceUrl) {
                    text += `View Full Invoice: ${data.invoiceUrl}\n\n`;
                }
                text += `If you have any questions, please contact our billing team.\n\n© Ovlox. All rights reserved.`;
                return text;

            case 'notification':
            default:
                return `${data.title || 'Notification'}\n\nHello ${data.firstName || 'there'},\n\n${data.message || data.content || 'You have a new notification.'}\n\n© Ovlox. All rights reserved.`;
        }
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<EmailJobPayload> | undefined, err: Error) {
        this.logger.error(`Email job failed: ${job?.id ?? 'unknown'} - ${err.message}`, EmailProcessor.name);
    }
}