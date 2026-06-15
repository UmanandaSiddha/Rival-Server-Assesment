import {
	Catch,
	ArgumentsHost,
	HttpStatus,
	HttpException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';
import { LoggerService } from 'src/services/logger/logger.service';

type PgErrorLike = {
	code?: string;
	message?: string;
	detail?: string;
	constraint?: string;
	column?: string;
};

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
	private readonly logger = new LoggerService(AllExceptionsFilter.name);

	private isPgError(exception: unknown): exception is PgErrorLike {
		return (
			!!exception
			&& typeof exception === 'object'
			&& typeof (exception as PgErrorLike).code === 'string'
		);
	}

	catch(exception: unknown, host: ArgumentsHost) {
		const ctx = host.switchToHttp();
		const response = ctx.getResponse<Response>();
		const request = ctx.getRequest<Request>();

		let status = HttpStatus.INTERNAL_SERVER_ERROR;
		let message: string | object = 'Internal server error';

		if (exception instanceof HttpException) {
			status = exception.getStatus();
			message = exception.getResponse();
		} else if (this.isPgError(exception)) {
			status = HttpStatus.BAD_REQUEST;

			switch (exception.code) {
				case '23505':
					status = HttpStatus.CONFLICT;
					message = exception.detail || `Unique constraint failed${exception.constraint ? ` (${exception.constraint})` : ''}`;
					break;
				case '23503':
					status = HttpStatus.CONFLICT;
					message = exception.detail || `Foreign key constraint failed${exception.constraint ? ` (${exception.constraint})` : ''}`;
					break;
				case '23502':
					message = `Missing required value${exception.column ? ` for column ${exception.column}` : ''}`;
					break;
				case '22P02':
					message = 'Invalid input syntax for database field';
					break;
				default:
					message = exception.message || 'Database error';
			}
		} else {
			status = HttpStatus.INTERNAL_SERVER_ERROR;
			const errMsg = exception instanceof Error ? exception.message : String(exception);
			message = process.env.NODE_ENV === 'production'
				? 'Something went wrong'
				: errMsg || 'Something went wrong';
		}

		response.status(status).json({
			statusCode: status,
			timestamp: new Date().toISOString(),
			path: request.url,
			error: message,
		});

		const rawError = exception instanceof Error ? exception.message : String(exception);
		this.logger.error(`Status ${status} - ${rawError} - ${request.url}`, AllExceptionsFilter.name);
		console.error(`[${status}] ${request.method} ${request.url} →`, rawError);

		// Don't call super.catch() — we already wrote the response; a second write → ERR_HTTP_HEADERS_SENT.
	}
}