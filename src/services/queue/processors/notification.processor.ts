import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { NotificationChannel, NotificationStatus, NotificationType, ExternalProvider, IntegrationStatus } from 'src/database/enums';
import { DatabaseService } from 'src/services/database/database.service';
import { LoggerService } from 'src/services/logger/logger.service';
import { OutboundActionsService } from 'src/services/outbound/outbound-actions.service';
import { EmailQueue } from '../email.queue';
import axios from 'axios';
import { Job } from 'bullmq';

type NotificationJobPayload = {
    notificationId: string;
    channel: NotificationChannel;
    userId: string;
    type: NotificationType;
    referenceId?: string;
};

/** Stale-lock cutoff — must match NotificationRecoveryService for the sweep to behave coherently. */
const STALE_LOCK_MINUTES = 5;

@Injectable()
@Processor('NOTIFICATION', { concurrency: parseInt(process.env.NOTIFICATION_QUEUE_CONCURRENCY ?? '10', 10) || 10 })
export class NotificationProcessor extends WorkerHost {
    private readonly logger = new LoggerService(NotificationProcessor.name);
    // Stable per-process workerId so the recovery sweep can attribute and reason about
    // who holds (or held) each lock. See WritebackExecutorService for the same pattern.
    private readonly workerId = `notif-proc:${process.pid}:${randomUUID().slice(0, 8)}`;

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly emailQueue: EmailQueue,
        private readonly outboundActions: OutboundActionsService,
    ) {
        super();
    }

    async process(job: Job<NotificationJobPayload>) {
        const { notificationId, channel } = job.data;

        // Atomic claim. NotificationLog has no intermediate "PROCESSING" status, so we use
        // `lockedAt` itself as the semaphore: a row is "claimed" iff lockedAt is set and recent.
        // Two replicas calling this concurrently — only one wins this UPDATE; the other sees
        // rowCount=0 and exits. Stale-lock recovery is handled by NotificationRecoveryService.
        const claim = await this.databaseService.query(
            `
                UPDATE "NotificationLog"
                SET "lockedAt" = NOW(),
                    "workerId" = $1
                WHERE "id" = $2
                    AND "status" IN ($3, $4)
                    AND (
                        "lockedAt" IS NULL
                        OR "lockedAt" < NOW() - ($5 || ' minutes')::interval
                    )
                RETURNING "id"
            `,
            [
                this.workerId,
                notificationId,
                NotificationStatus.PENDING,
                NotificationStatus.FAILED,
                String(STALE_LOCK_MINUTES),
            ],
        );

        if (claim.rowCount === 0) {
            // Either the notification was already sent, or another worker is mid-flight on
            // the same row. Either way we exit silently — duplicate sends are the precise
            // problem this guard exists to prevent.
            this.logger.log(
                `Notification ${notificationId} not claimable — another worker has it or it's already terminal`,
                NotificationProcessor.name,
            );
            return;
        }

        try {
            this.logger.log(`Processing notification ${notificationId} via ${channel}`, NotificationProcessor.name);

            switch (channel) {
                case 'EMAIL':
                    await this.sendEmailNotification(job.data);
                    break;
                case 'IN_APP':
                    await this.createInAppNotification(job.data);
                    break;
                case 'SLACK':
                    await this.sendSlackNotification(job.data);
                    break;
                case 'DISCORD':
                    await this.sendDiscordNotification(job.data);
                    break;
            }

            // Release the lock on success — sweep should never see a SENT row.
            await this.databaseService.query(
                `
                    UPDATE "NotificationLog"
                    SET
                        "status" = $1,
                        "sentAt" = NOW(),
                        "lockedAt" = NULL,
                        "workerId" = NULL
                    WHERE "id" = $2
                `,
                [NotificationStatus.SENT, notificationId],
            );

            this.logger.log(`Notification ${notificationId} sent successfully`, NotificationProcessor.name);
        } catch (error) {
            this.logger.error(`Failed to process notification ${notificationId}: ${error.message}`, NotificationProcessor.name);

            // Bounded exponential backoff in minutes (1,2,4,8,16, capped at 30). The previous
            // Math.pow(5, attemptsMade) scheduled retries hours/days out (attempt 4 → 625 min).
            const backoffMinutes = Math.min(Math.pow(2, job.attemptsMade), 30);
            const nextRetryDate = new Date();
            nextRetryDate.setMinutes(nextRetryDate.getMinutes() + backoffMinutes);

            // Release the lock on failure too — the row goes back to FAILED with a nextRetryAt
            // and the sweep handles re-enqueue when the window elapses.
            // RETURNING the new retryCount so we can emit the same [STUCK-FINAL] telemetry
            // format the other recovery surfaces use when this failure pushes the row past
            // its retry budget.
            const updateResult = await this.databaseService.query<{
                retryCount: number;
                userId: string;
                channel: string;
                type: string;
            }>(
                `
                    UPDATE "NotificationLog"
                    SET
                        "status" = $1,
                        "retryCount" = COALESCE("retryCount", 0) + 1,
                        "failedAt" = NOW(),
                        "nextRetryAt" = $2,
                        "lockedAt" = NULL,
                        "workerId" = NULL
                    WHERE "id" = $3
                    RETURNING "retryCount", "userId", "channel", "type"
                `,
                [NotificationStatus.FAILED, nextRetryDate, notificationId],
            );

            const NOTIFICATION_MAX_RETRIES = 3;
            const row = updateResult.rows[0];
            if (row && row.retryCount >= NOTIFICATION_MAX_RETRIES) {
                this.logger.error(
                    `[STUCK-FINAL] surface=notification id=${notificationId} ` +
                    `channel=${row.channel} type=${row.type} userId=${row.userId} ` +
                    `retryCount=${row.retryCount} error=${JSON.stringify(error.message)}`,
                    NotificationProcessor.name,
                );
            }

            throw error;
        }
    }

    private async sendEmailNotification(data: NotificationJobPayload) {
        const userResult = await this.databaseService.query(
            `
                SELECT "email", "firstName"
                FROM "User"
                WHERE "id" = $1
                LIMIT 1
            `,
            [data.userId],
        );

        const user = userResult.rows[0] || null;

        if (!user?.email) {
            throw new Error(`No email found for user ${data.userId}`);
        }

        await this.emailQueue.enqueue({
            to: user.email,
            subject: `Ovlox Notification: ${data.type}`,
            template: 'notification',
            data: {
                message: `You have a new ${data.type} notification in Ovlox.`,
                firstName: user.firstName,
                referenceId: data.referenceId,
            },
        });

        this.logger.log(`Email notification queued for ${user.email}`, NotificationProcessor.name);
    }

    private async createInAppNotification(data: NotificationJobPayload) {
        // NotificationLog record is the in-app notification source of truth.
        this.logger.log(`In-app notification recorded for user ${data.userId}`, NotificationProcessor.name);
    }

    private async sendSlackNotification(data: NotificationJobPayload) {
        const orgMembershipResult = await this.databaseService.query(
            `
                SELECT "organizationId"
                FROM "OrganizationMember"
                WHERE "userId" = $1
                LIMIT 1
            `,
            [data.userId],
        );

        const orgMembership = orgMembershipResult.rows[0] || null;
        if (!orgMembership) {
            throw new Error(`No organization membership found for user ${data.userId}`);
        }

        const slackIntegrationResult = await this.databaseService.query(
            `
                SELECT "id", "config"
                FROM "Integration"
                WHERE "organizationId" = $1
                    AND "type" = $2
                    AND "status" = $3
                LIMIT 1
            `,
            [orgMembership.organizationId, ExternalProvider.SLACK, IntegrationStatus.CONNECTED],
        );

        const slackIntegration = slackIntegrationResult.rows[0] || null;
        if (!slackIntegration) {
            throw new Error(`Slack integration not connected for organization ${orgMembership.organizationId}`);
        }

        const config = slackIntegration.config as any;
        const notificationChannelId = config?.notificationChannelId;
        const message = `Ovlox notification (${data.type})${data.referenceId ? ` — ref: ${data.referenceId}` : ''}`;

        if (notificationChannelId) {
            // Use bot token via OutboundActionsService
            await this.outboundActions.sendSlackMessage(slackIntegration.id, notificationChannelId, message);
        } else {
            // Fallback to webhook URL
            const webhookUrl = config?.webhookUrl || config?.incomingWebhookUrl;
            if (!webhookUrl) {
                throw new Error(`No Slack notification channel or webhook URL configured`);
            }
            await axios.post(webhookUrl, { text: message });
        }

        this.logger.log(`Slack notification dispatched for user ${data.userId}`, NotificationProcessor.name);
    }

    private async sendDiscordNotification(data: NotificationJobPayload) {
        const orgMembershipResult = await this.databaseService.query(
            `
                SELECT "organizationId"
                FROM "OrganizationMember"
                WHERE "userId" = $1
                LIMIT 1
            `,
            [data.userId],
        );

        const orgMembership = orgMembershipResult.rows[0] || null;
        if (!orgMembership) {
            throw new Error(`No organization membership found for user ${data.userId}`);
        }

        const discordIntegrationResult = await this.databaseService.query(
            `
                SELECT "id", "config"
                FROM "Integration"
                WHERE "organizationId" = $1
                    AND "type" = $2
                    AND "status" = $3
                LIMIT 1
            `,
            [orgMembership.organizationId, ExternalProvider.DISCORD, IntegrationStatus.CONNECTED],
        );

        const discordIntegration = discordIntegrationResult.rows[0] || null;
        if (!discordIntegration) {
            throw new Error(`Discord integration not connected for organization ${orgMembership.organizationId}`);
        }

        const config = discordIntegration.config as any;
        const notificationChannelId = config?.notificationChannelId;
        const message = `Ovlox notification (${data.type})${data.referenceId ? ` — ref: ${data.referenceId}` : ''}`;

        if (notificationChannelId) {
            // Use bot token via OutboundActionsService
            await this.outboundActions.sendDiscordMessage(notificationChannelId, message);
        } else {
            // Fallback to webhook URL
            const webhookUrl = config?.webhookUrl;
            if (!webhookUrl) {
                throw new Error(`No Discord notification channel or webhook URL configured`);
            }
            await axios.post(webhookUrl, { content: message });
        }

        this.logger.log(`Discord notification dispatched for user ${data.userId}`, NotificationProcessor.name);
    }

    @OnWorkerEvent('completed')
    onCompleted(job: Job<NotificationJobPayload>) {
        this.logger.log(`Notification worker completed job=${job.id}`, NotificationProcessor.name);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<NotificationJobPayload> | undefined, err: Error) {
        this.logger.error(`Notification worker failed job=${job?.id} err=${err?.message}`, NotificationProcessor.name);
    }
}

