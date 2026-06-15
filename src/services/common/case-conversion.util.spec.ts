import { toCamelCaseDeep } from './case-conversion.util';

describe('toCamelCaseDeep', () => {
    it('converts snake_case keys to camelCase', () => {
        expect(
            toCamelCaseDeep({ first_name: 'Ada', created_at: '2020' }),
        ).toEqual({
            firstName: 'Ada',
            createdAt: '2020',
        });
    });

    it('recurses through nested objects and arrays', () => {
        const input = {
            team_id: 't1',
            team_members: [{ user_id: 'u1' }, { user_id: 'u2' }],
        };
        expect(toCamelCaseDeep(input)).toEqual({
            teamId: 't1',
            teamMembers: [{ userId: 'u1' }, { userId: 'u2' }],
        });
    });

    it('leaves Date instances and primitives untouched', () => {
        const due = new Date('2020-01-01T00:00:00.000Z');
        const out = toCamelCaseDeep<any>({
            due_date: due,
            count: 3,
            is_done: true,
            note: null,
        });
        expect(out.dueDate).toBe(due); // same reference, not stringified
        expect(out).toEqual({
            dueDate: due,
            count: 3,
            isDone: true,
            note: null,
        });
    });
});
