import 'reflect-metadata';
import { EditLockService } from './edit-lock.service';

function makeService() {
    const redis = {
        setNxEx: jest.fn(),
        set: jest.fn().mockResolvedValue(undefined),
        get: jest.fn(),
        del: jest.fn().mockResolvedValue(1),
    } as any;
    const publisher = {
        emitToTeam: jest.fn().mockResolvedValue(undefined),
    } as any;
    return { redis, publisher, svc: new EditLockService(redis, publisher) };
}

const user = { id: 'u1', firstName: 'Ada' };

describe('EditLockService', () => {
    it('acquires a free lock and broadcasts edit_locked', async () => {
        const { redis, publisher, svc } = makeService();
        redis.setNxEx.mockResolvedValue(true);

        const res = await svc.acquire('t1', 'task1', user);

        expect(res.ok).toBe(true);
        expect(res.holder?.userId).toBe('u1');
        expect(publisher.emitToTeam).toHaveBeenCalledWith(
            't1',
            'task.edit_locked',
            expect.anything(),
            'u1',
        );
    });

    it('is re-entrant for the current holder: refreshes TTL, no second broadcast', async () => {
        const { redis, publisher, svc } = makeService();
        redis.setNxEx.mockResolvedValue(false); // already locked
        redis.get.mockResolvedValue(JSON.stringify({ userId: 'u1' })); // ...by the same user

        const res = await svc.acquire('t1', 'task1', user);

        expect(res.ok).toBe(true);
        expect(redis.set).toHaveBeenCalled(); // TTL extended
        expect(publisher.emitToTeam).not.toHaveBeenCalled();
    });

    it('fails when another user holds the lock', async () => {
        const { redis, svc } = makeService();
        redis.setNxEx.mockResolvedValue(false);
        redis.get.mockResolvedValue(JSON.stringify({ userId: 'someone-else' }));

        const res = await svc.acquire('t1', 'task1', user);

        expect(res.ok).toBe(false);
        expect(res.holder).toEqual({ userId: 'someone-else' });
    });

    it('release does nothing when the caller is not the holder', async () => {
        const { redis, publisher, svc } = makeService();
        redis.get.mockResolvedValue(JSON.stringify({ userId: 'someone-else' }));

        await svc.release('t1', 'task1', user);

        expect(redis.del).not.toHaveBeenCalled();
        expect(publisher.emitToTeam).not.toHaveBeenCalled();
    });

    it('release clears the lock and broadcasts when the caller holds it', async () => {
        const { redis, publisher, svc } = makeService();
        redis.get.mockResolvedValue(JSON.stringify({ userId: 'u1' }));

        await svc.release('t1', 'task1', user);

        expect(redis.del).toHaveBeenCalled();
        expect(publisher.emitToTeam).toHaveBeenCalledWith(
            't1',
            'task.edit_unlocked',
            expect.anything(),
            'u1',
        );
    });
});
