import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/services/redis/redis.service';
import { DatabaseService } from 'src/services/database/database.service';

/**
 * Centralized service for managing user online/offline status and socket registration
 * Prevents redundancy between app.gateway and chat.gateway
 */
@Injectable()
export class UserPresenceService {
    constructor(
        private readonly redisService: RedisService,
        private readonly databaseService: DatabaseService,
    ) { }

    /**
     * Register a new socket for a user. Safe to call from multiple gateways/namespaces — the
     * Redis registry is now a SET so a single user can hold N concurrent sockets without
     * the disconnect of one wiping the others' presence record.
     *
     * User.isOnline is set to TRUE idempotently (the WHERE clause skips the write when the
     * row is already online, so reconnect storms don't generate write churn).
     */
    async handleUserConnect(userId: string, socketId: string): Promise<void> {
        try {
            await this.redisService.registerSocket(userId, socketId);

            await this.databaseService.query(
                `
                    UPDATE "User"
                    SET
                        "isOnline" = TRUE,
                        "updated_at" = NOW()
                    WHERE "id" = $1 AND "isOnline" = FALSE
                `,
                [userId],
            );
            console.log(`[UserPresence] User ${userId} connected with socket ${socketId}`);
        } catch (error) {
            console.error(`[UserPresence] Error handling user connect:`, error);
        }
    }

    /**
     * Remove a single socket from a user's presence record. Only flips User.isOnline to FALSE
     * when this was the user's LAST live socket — closing one tab while another is still
     * connected used to incorrectly mark the user offline.
     */
    async handleUserDisconnect(socketId: string): Promise<void> {
        try {
            const { userId, wasLast } = await this.redisService.unregisterSocket(socketId);

            if (userId && wasLast) {
                await this.databaseService.query(
                    `
                        UPDATE "User"
                        SET
                            "isOnline" = FALSE,
                            "updated_at" = NOW()
                        WHERE "id" = $1
                    `,
                    [userId],
                );
                console.log(`[UserPresence] User ${userId} disconnected (last socket ${socketId})`);
            } else if (userId) {
                console.log(`[UserPresence] User ${userId} dropped socket ${socketId}, still online via other sockets`);
            }
        } catch (error) {
            console.error(`[UserPresence] Error handling user disconnect:`, error);
        }
    }

    /**
     * Get a single socket ID for a user (legacy callers — returns any one socket).
     * For fan-out emit-to-user use {@link getSocketIdsByUser} instead.
     */
    async getSocketIdByUser(userId: string): Promise<string | null> {
        return this.redisService.getSocketIdByUser(userId);
    }

    /** Get every active socket ID for a user, across all namespaces. */
    async getSocketIdsByUser(userId: string): Promise<string[]> {
        return this.redisService.getSocketIdsByUser(userId);
    }

    /**
     * Get user ID for a socket
     */
    async getUserBySocket(socketId: string): Promise<string | null> {
        return this.redisService.getUserBySocket(socketId);
    }
}
