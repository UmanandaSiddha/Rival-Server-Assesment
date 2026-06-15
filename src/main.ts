import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { corsOriginCallback } from './config/origin';

// TRUST_PROXY: "true"/"false", a hop count, or a comma-separated IP/subnet list.
function parseTrustProxyValue(value?: string): boolean | number | string | string[] | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'true') return true;
	if (normalized === 'false') return false;
	if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
	if (value.includes(',')) return value.split(',').map((entry) => entry.trim()).filter(Boolean);
	return value;
}

// Log stray async rejections; exit on a real uncaught exception so the orchestrator restarts cleanly.
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (error) => {
	console.error('Uncaught Exception:', error);
	process.exit(1);
});

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		logger: ['debug', 'error', 'log', 'warn'],
	});

	const configService = app.get(ConfigService);

	// Behind a proxy/LB, trust X-Forwarded-* so client IPs (rate limiting) are correct.
	const trustProxy = parseTrustProxyValue(configService.get<string>('TRUST_PROXY'));
	if (trustProxy !== undefined) {
		app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
	}

	app.setGlobalPrefix('api/v1');

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true, // reject unknown props (mass-assignment defense)
			transform: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	);

	const { httpAdapter } = app.get(HttpAdapterHost);
	app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

	app.use(cookieParser());

	// Serve uploaded attachments read-only at /uploads/**.
	app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

	app.enableCors({
		origin: corsOriginCallback,
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
		credentials: true,
		allowedHeaders: ['Content-Type', 'Authorization'],
	});

	// Drain DB pools / BullMQ workers cleanly on SIGTERM/SIGINT instead of dying mid-flight.
	app.enableShutdownHooks();

	const PORT = configService.get<string>('PORT') || 4000;
	await app.listen(PORT);
	console.log(`Server running on port ${PORT}`);
}

bootstrap().catch((err) => {
	console.error('Fatal bootstrap error:', err);
	process.exit(1);
});
