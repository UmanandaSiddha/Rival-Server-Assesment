import { Injectable, ConsoleLogger, Scope } from '@nestjs/common';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';

/**
 * TRANSIENT scope so each consumer gets its own instance — as a singleton, one service's
 * `setContext('Foo')` re-labelled every other service's logs (shared ConsoleLogger).
 */
@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService extends ConsoleLogger {
    async logToFile(entry: any, type: 'ERROR' | 'LOG' | 'WARN') {
        const formattedEntry = `${type}\t${Intl.DateTimeFormat('en-US', {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: 'Asia/Kolkata',
        }).format(new Date())}\t${entry}\n`;

        // Use LOG_DIR if set (e.g. in ECS); else cwd/logs so container can use /app/logs
        const logsDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

        try {
            if (!fs.existsSync(logsDir)) {
                await fsPromises.mkdir(logsDir, { recursive: true });
            }
            await fsPromises.appendFile(
                path.join(logsDir, 'LogFile.log'),
                formattedEntry,
            );
        } catch (e) {
            if (e instanceof Error) console.error(e.message);
        }
    }

    convertToString(message: any): string {
        if (typeof message !== 'string') {
            const compact = JSON.stringify(message);
            message = compact.replace(/:/g, ': ').replace(/,/g, ', ');
        }

        return message;
    }

    /**
     * Forward `context` only when it's a non-empty string — ConsoleLogger prints each optional param
     * on its own line, so a `undefined` context produced a stray `[Context] undefined` line per log.
     */
    log(message: any, context?: string) {
        message = this.convertToString(message);
        const ctx = context ?? (this as any).context;
        this.logToFile(`${ctx ?? ''}\t${message}`, 'LOG');
        if (context) {
            super.log(message, context);
        } else {
            super.log(message);
        }
    }

    error(message: any, stackOrContext?: string) {
        message = this.convertToString(message);
        const ctx = stackOrContext ?? (this as any).context;
        this.logToFile(`${ctx ?? ''}\t${message}`, 'ERROR');
        if (stackOrContext) {
            super.error(message, stackOrContext);
        } else {
            super.error(message);
        }
    }

    // ConsoleLogger.warn wasn't overridden, so warnings never reached LogFile.log — best-effort
    // failures and deprecation markers (e.g. AuthorizationService's fallback) were console-only.
    // Mirror log()/error() so warnings are persisted too.
    warn(message: any, context?: string) {
        message = this.convertToString(message);
        const ctx = context ?? (this as any).context;
        this.logToFile(`${ctx ?? ''}\t${message}`, 'WARN');
        if (context) {
            super.warn(message, context);
        } else {
            super.warn(message);
        }
    }
}
