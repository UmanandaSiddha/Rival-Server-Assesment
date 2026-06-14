import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';

/**
 * Task attachments — uploaded files (stored locally, served at /uploads/**) and external links
 * (with a best-effort OpenGraph preview). Attaching/removing requires TASK_UPDATE; changes broadcast
 * to the team in real time.
 */
@Module({
    imports: [AuthModule, RealtimeModule],
    controllers: [AttachmentController],
    providers: [AttachmentService],
    exports: [AttachmentService],
})
export class AttachmentModule { }
