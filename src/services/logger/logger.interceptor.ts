import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggerService } from './logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    constructor(private readonly logger: LoggerService) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const response = context.switchToHttp().getResponse();
        const { method, originalUrl } = request;

        this.logger.log(`--> ${method} ${originalUrl}`, 'HTTP');

        const now = Date.now();
        return next
            .handle()
            .pipe(
                tap(() => {
                    const { statusCode } = response;
                    const elapsedTime = Date.now() - now;

                    // Log the outgoing response using your service
                    this.logger.log(
                        `<-- ${method} ${originalUrl} ${statusCode} - ${elapsedTime}ms`,
                        'HTTP',
                    );
                }),
            );
    }
}