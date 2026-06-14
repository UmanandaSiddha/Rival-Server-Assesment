import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { corsOriginCallback } from './config/origin';

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule);

	// Serve uploaded attachments read-only at /uploads/**.
	app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

	app.use(cookieParser());

	// Allowlisted origins (see config/origin.ts); credentials on so auth cookies flow cross-origin.
	app.enableCors({ origin: corsOriginCallback, credentials: true });

	app.useGlobalPipes(
		new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
	);

	const { httpAdapter } = app.get(HttpAdapterHost);
	app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

	await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
