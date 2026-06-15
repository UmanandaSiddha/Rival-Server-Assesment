import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard, getUser } from '../auth/guards/auth.guard';
import { UserRole } from 'src/database/enums';
import { InviteService } from './invite.service';
import { CreateInviteDto } from './dto/create-invite.dto';

interface RequestUser {
    id: string;
    role?: UserRole;
    email?: string;
    firstName?: string;
    lastName?: string;
}

/**
 * Team-scoped invite management lives under /teams/:teamId/invites (auth + MEMBER_INVITE).
 * Token actions live under /invites/:token — accept/decline require auth (you need an account);
 * GET /invites/:token is public so a recipient can preview the invite before logging in.
 */
@Controller()
export class InviteController {
    constructor(private readonly inviteService: InviteService) {}

    @UseGuards(AuthGuard)
    @Post('teams/:teamId/invites')
    create(
        @getUser() user: RequestUser,
        @Param('teamId') teamId: string,
        @Body() dto: CreateInviteDto,
    ) {
        return this.inviteService.create(user, teamId, dto);
    }

    @UseGuards(AuthGuard)
    @Get('teams/:teamId/invites')
    list(@getUser() user: RequestUser, @Param('teamId') teamId: string) {
        return this.inviteService.list(user, teamId);
    }

    @UseGuards(AuthGuard)
    @Delete('teams/:teamId/invites/:inviteId')
    revoke(
        @getUser() user: RequestUser,
        @Param('teamId') teamId: string,
        @Param('inviteId') inviteId: string,
    ) {
        return this.inviteService.revoke(user, teamId, inviteId);
    }

    // Public preview — no auth.
    @Get('invites/:token')
    getByToken(@Param('token') token: string) {
        return this.inviteService.getByToken(token);
    }

    @UseGuards(AuthGuard)
    @Post('invites/:token/accept')
    accept(@getUser() user: RequestUser, @Param('token') token: string) {
        return this.inviteService.accept(user, token);
    }

    @UseGuards(AuthGuard)
    @Post('invites/:token/decline')
    decline(@getUser() user: RequestUser, @Param('token') token: string) {
        return this.inviteService.decline(user, token);
    }
}
