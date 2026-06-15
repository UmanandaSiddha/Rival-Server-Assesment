import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './services/database/database.module';
import { RedisModule } from './services/redis/redis.module';
import { LoggerModule } from './services/logger/logger.module';
import { QueueModule } from './services/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TaskModule } from './modules/task/task.module';
import { TeamModule } from './modules/team/team.module';
import { AttachmentModule } from './modules/attachment/attachment.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
	imports: [
		ConfigModule.forRoot({ isGlobal: true }),
		DatabaseModule,
		RedisModule,
		LoggerModule,
		QueueModule,
		AuthModule,
		RealtimeModule,
		TaskModule,
		TeamModule,
		AttachmentModule,
		AdminModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule { }
