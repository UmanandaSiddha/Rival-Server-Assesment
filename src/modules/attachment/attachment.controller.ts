import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { UserRole } from 'src/database/enums';
import { AttachmentService, UploadedFile as UploadedFileType } from './attachment.service';
import { AddLinkDto } from './dto/add-link.dto';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

interface RequestUser {
    id: string;
    role?: UserRole;
}

@Controller('tasks/:taskId/attachments')
@UseGuards(AuthGuard)
export class AttachmentController {
    constructor(private readonly attachmentService: AttachmentService) { }

    @Get()
    list(@getUser() user: RequestUser, @Param('taskId') taskId: string) {
        return this.attachmentService.list(user, taskId);
    }

    // Multipart upload (field name "file"). Held in memory then written after authorization.
    @Post('file')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
    uploadFile(
        @getUser() user: RequestUser,
        @Param('taskId') taskId: string,
        @UploadedFile() file: UploadedFileType,
    ) {
        return this.attachmentService.uploadFile(user, taskId, file);
    }

    @Post('link')
    addLink(@getUser() user: RequestUser, @Param('taskId') taskId: string, @Body() dto: AddLinkDto) {
        return this.attachmentService.addLink(user, taskId, dto);
    }

    @Delete(':attachmentId')
    remove(
        @getUser() user: RequestUser,
        @Param('taskId') taskId: string,
        @Param('attachmentId') attachmentId: string,
    ) {
        return this.attachmentService.remove(user, taskId, attachmentId);
    }
}
