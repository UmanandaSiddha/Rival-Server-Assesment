import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthorizationService, TeamAccess } from './authorization.service';
import { Permission, UserRole } from 'src/database/enums';

type QueryImpl = (sql: string, params: any[]) => Promise<{ rows: any[] }>;
const dbMock = (impl: QueryImpl) => ({ query: jest.fn(impl) }) as any;

// Returns the owner row for the Team lookup; everything else (membership) returns `memberRows`.
const dbFor = (ownerId: string, memberRows: any[]) =>
    dbMock(async (sql: string) => {
        if (sql.includes('FROM "Team"')) return { rows: [{ ownerId }] };
        return { rows: memberRows };
    });

describe('AuthorizationService', () => {
    describe('getTeamAccess', () => {
        it('grants full access to the team owner', async () => {
            const svc = new AuthorizationService(dbFor('u1', []));
            const access = await svc.getTeamAccess('u1', 't1');
            expect(access.isOwner).toBe(true);
            expect(access.hasAll).toBe(true);
        });

        it('grants full access to an app-level admin who is not a member', async () => {
            const svc = new AuthorizationService(dbFor('owner', []));
            const access = await svc.getTeamAccess(
                'admin',
                't1',
                UserRole.ADMIN,
            );
            expect(access.isAppAdmin).toBe(true);
            expect(access.hasAll).toBe(true);
        });

        it("returns a member's role permissions", async () => {
            const svc = new AuthorizationService(
                dbFor('owner', [{ permissions: ['TASK_READ', 'TASK_CREATE'] }]),
            );
            const access = await svc.getTeamAccess('member', 't1');
            expect(access.hasAll).toBe(false);
            expect(access.permissions).toEqual(['TASK_READ', 'TASK_CREATE']);
        });

        it('throws NotFound when the team does not exist', async () => {
            const svc = new AuthorizationService(
                dbMock(async () => ({ rows: [] })),
            );
            await expect(
                svc.getTeamAccess('u', 'missing'),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('throws Forbidden when the user is not a member', async () => {
            const svc = new AuthorizationService(dbFor('owner', []));
            await expect(
                svc.getTeamAccess('stranger', 't1'),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });
    });

    describe('assertTeamPermission', () => {
        it('passes when the member has the permission', async () => {
            const svc = new AuthorizationService(
                dbFor('owner', [{ permissions: ['TASK_READ'] }]),
            );
            await expect(
                svc.assertTeamPermission('m', 't1', Permission.TASK_READ),
            ).resolves.toBeDefined();
        });

        it('rejects when the member lacks the permission', async () => {
            const svc = new AuthorizationService(
                dbFor('owner', [{ permissions: ['TASK_READ'] }]),
            );
            await expect(
                svc.assertTeamPermission('m', 't1', Permission.TASK_DELETE),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });
    });

    describe('can / assertCan (owner bypass)', () => {
        const svc = new AuthorizationService(
            dbMock(async () => ({ rows: [] })),
        );
        const ownerAccess: TeamAccess = {
            teamId: 't1',
            isOwner: true,
            isAppAdmin: false,
            hasAll: true,
            permissions: [],
        };

        it('owner can do anything regardless of permission list', () => {
            expect(svc.can(ownerAccess, Permission.TASK_DELETE)).toBe(true);
            expect(() =>
                svc.assertCan(ownerAccess, Permission.TASK_DELETE),
            ).not.toThrow();
        });

        it('a member without the permission is denied', () => {
            const memberAccess: TeamAccess = {
                ...ownerAccess,
                isOwner: false,
                hasAll: false,
                permissions: [Permission.TASK_READ],
            };
            expect(svc.can(memberAccess, Permission.TASK_DELETE)).toBe(false);
            expect(() =>
                svc.assertCan(memberAccess, Permission.TASK_DELETE),
            ).toThrow(ForbiddenException);
        });
    });
});
