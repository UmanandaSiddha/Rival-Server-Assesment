// Auto-generated from db/migrations CREATE TYPE statements.
// Run `npm run db:generate-enums` after changing enum migrations. Do not edit by hand.

export const UserRole = {
	ADMIN: 'ADMIN',
	USER: 'USER',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const Permission = {
	TASK_READ: 'TASK_READ',
	TASK_CREATE: 'TASK_CREATE',
	TASK_UPDATE: 'TASK_UPDATE',
	TASK_DELETE: 'TASK_DELETE',
	TASK_UPDATE_STATUS: 'TASK_UPDATE_STATUS',
	TASK_UPDATE_PRIORITY: 'TASK_UPDATE_PRIORITY',
	TASK_ASSIGN: 'TASK_ASSIGN',
	MEMBER_INVITE: 'MEMBER_INVITE',
	MEMBER_REMOVE: 'MEMBER_REMOVE',
	MEMBER_UPDATE_ROLE: 'MEMBER_UPDATE_ROLE',
	ROLE_CREATE: 'ROLE_CREATE',
	ROLE_UPDATE: 'ROLE_UPDATE',
	ROLE_DELETE: 'ROLE_DELETE',
	TEAM_UPDATE: 'TEAM_UPDATE',
	TEAM_DELETE: 'TEAM_DELETE',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const InviteStatus = {
	PENDING: 'PENDING',
	ACCEPTED: 'ACCEPTED',
	DECLINED: 'DECLINED',
	EXPIRED: 'EXPIRED',
	REVOKED: 'REVOKED',
} as const;

export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];

export const TaskStatus = {
	TODO: 'TODO',
	IN_PROGRESS: 'IN_PROGRESS',
	DONE: 'DONE',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskPriority = {
	LOW: 'LOW',
	MEDIUM: 'MEDIUM',
	HIGH: 'HIGH',
	URGENT: 'URGENT',
} as const;

export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const TaskActivityAction = {
	CREATED: 'CREATED',
	UPDATED: 'UPDATED',
	STATUS_CHANGED: 'STATUS_CHANGED',
	ASSIGNED: 'ASSIGNED',
	COMPLETED: 'COMPLETED',
	REOPENED: 'REOPENED',
	DELETED: 'DELETED',
} as const;

export type TaskActivityAction = (typeof TaskActivityAction)[keyof typeof TaskActivityAction];

export const AttachmentType = {
	FILE: 'FILE',
	LINK: 'LINK',
} as const;

export type AttachmentType = (typeof AttachmentType)[keyof typeof AttachmentType];

