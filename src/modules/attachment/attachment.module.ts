import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';

/**
 * Task attachments — local files (served at /uploads/**) and external links with an
 * OpenGraph preview. Mutations require TASK_UPDATE and broadcast to the team.
 */
@Module({
    imports: [AuthModule, RealtimeModule],
    controllers: [AttachmentController],
    providers: [AttachmentService],
    exports: [AttachmentService],
})
export class AttachmentModule {}
