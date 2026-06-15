import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';
import { DatabaseService } from 'src/services/database/database.service';
import { toCamelCaseDeep } from 'src/services/common/case-conversion.util';
import { AttachmentType, Permission, UserRole } from 'src/database/enums';
import { AuthorizationService } from '../auth/authorization.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { AddLinkDto } from './dto/add-link.dto';

// Local file storage root; served read-only at /uploads/** (see main.ts useStaticAssets).
const UPLOAD_ROOT = join(process.cwd(), 'uploads');
const MAX_LINK_PREVIEW_BYTES = 512 * 1024;

interface RequestUser {
    id: string;
    role?: UserRole;
}

export interface UploadedFile {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
}

@Injectable()
export class AttachmentService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly authorizationService: AuthorizationService,
        private readonly publisher: RealtimePublisher,
    ) {}

    async list(user: RequestUser, taskId: string) {
        const access = await this.authorizationService.getTaskAccess(
            user.id,
            taskId,
            user.role,
        );
        this.authorizationService.assertCan(access, Permission.TASK_READ);

        const result = await this.databaseService.query(
            `SELECT * FROM "TaskAttachment" WHERE "taskId" = $1 ORDER BY "created_at" DESC`,
            [taskId],
        );
        return toCamelCaseDeep(result.rows);
    }

    async uploadFile(user: RequestUser, taskId: string, file?: UploadedFile) {
        if (!file) throw new BadRequestException('No file uploaded');

        // Authorize BEFORE writing to disk so an unauthorized request never creates a file.
        const access = await this.authorizationService.getTaskAccess(
            user.id,
            taskId,
            user.role,
        );
        this.authorizationService.assertCan(access, Permission.TASK_UPDATE);

        const safeName =
            file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) ||
            'file';
        const storedName = `${crypto.randomBytes(8).toString('hex')}-${safeName}`;
        const dir = join(UPLOAD_ROOT, 'tasks', taskId);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(join(dir, storedName), file.buffer);

        const url = `/uploads/tasks/${taskId}/${storedName}`;
        const isImage = file.mimetype.startsWith('image/');

        const result = await this.databaseService.query(
            `
                INSERT INTO "TaskAttachment"
                    ("taskId", "uploadedById", "type", "name", "url", "mimeType", "sizeBytes", "storageProvider", "previewUrl", "metadata")
                VALUES ($1, $2, $3::"AttachmentType", $4, $5, $6, $7, 'local', $8, $9)
                RETURNING *
            `,
            [
                taskId,
                user.id,
                AttachmentType.FILE,
                file.originalname,
                url,
                file.mimetype,
                file.size,
                isImage ? url : null,
                JSON.stringify({ originalName: file.originalname }),
            ],
        );

        const attachment = toCamelCaseDeep(result.rows[0]);
        await this.publisher.emitToTeam(
            access.teamId,
            'task.attachment_added',
            { taskId, attachment },
            user.id,
        );
        return attachment;
    }

    async addLink(user: RequestUser, taskId: string, dto: AddLinkDto) {
        const access = await this.authorizationService.getTaskAccess(
            user.id,
            taskId,
            user.role,
        );
        this.authorizationService.assertCan(access, Permission.TASK_UPDATE);

        const preview = await this.fetchLinkPreview(dto.url);
        const name = dto.name || preview.title || this.hostnameOf(dto.url);

        const result = await this.databaseService.query(
            `
                INSERT INTO "TaskAttachment"
                    ("taskId", "uploadedById", "type", "name", "url", "previewUrl", "metadata")
                VALUES ($1, $2, $3::"AttachmentType", $4, $5, $6, $7)
                RETURNING *
            `,
            [
                taskId,
                user.id,
                AttachmentType.LINK,
                name,
                dto.url,
                preview.image ?? null,
                JSON.stringify(preview),
            ],
        );

        const attachment = toCamelCaseDeep(result.rows[0]);
        await this.publisher.emitToTeam(
            access.teamId,
            'task.attachment_added',
            { taskId, attachment },
            user.id,
        );
        return attachment;
    }

    async remove(user: RequestUser, taskId: string, attachmentId: string) {
        const access = await this.authorizationService.getTaskAccess(
            user.id,
            taskId,
            user.role,
        );
        this.authorizationService.assertCan(access, Permission.TASK_UPDATE);

        const found = await this.databaseService.query(
            `SELECT * FROM "TaskAttachment" WHERE "id" = $1 AND "taskId" = $2 LIMIT 1`,
            [attachmentId, taskId],
        );
        const row = found.rows[0];
        if (!row) throw new NotFoundException('Attachment not found');

        await this.databaseService.query(
            `DELETE FROM "TaskAttachment" WHERE "id" = $1`,
            [attachmentId],
        );

        // Best-effort: remove the file from disk for local uploads.
        if (
            row.type === AttachmentType.FILE &&
            row.storageProvider === 'local' &&
            typeof row.url === 'string'
        ) {
            const relative = row.url.replace(/^\/uploads\//, '');
            await fs.unlink(join(UPLOAD_ROOT, relative)).catch(() => undefined);
        }

        await this.publisher.emitToTeam(
            access.teamId,
            'task.attachment_removed',
            { taskId, attachmentId },
            user.id,
        );
        return { ok: true };
    }

    // --- Link preview (best-effort OpenGraph scrape; never throws) ---

    private async fetchLinkPreview(url: string): Promise<{
        title?: string;
        description?: string;
        siteName?: string;
        image?: string;
    }> {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(3000),
                headers: { 'user-agent': 'rival-tasks-linkpreview/1.0' },
            });
            const contentType = response.headers.get('content-type') ?? '';
            if (!response.ok || !contentType.includes('text/html')) return {};

            const html = (await response.text()).slice(
                0,
                MAX_LINK_PREVIEW_BYTES,
            );
            return {
                title:
                    this.metaContent(html, 'og:title') ?? this.titleTag(html),
                description: this.metaContent(html, 'og:description'),
                siteName: this.metaContent(html, 'og:site_name'),
                image: this.metaContent(html, 'og:image'),
            };
        } catch {
            return {};
        }
    }

    private metaContent(html: string, property: string): string | undefined {
        const pattern = new RegExp(
            `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
            'i',
        );
        return html.match(pattern)?.[1];
    }

    private titleTag(html: string): string | undefined {
        return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    }

    private hostnameOf(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }
}
