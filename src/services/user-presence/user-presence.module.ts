import { Module } from '@nestjs/common';
import { UserPresenceService } from './user-presence.service';
import { RedisModule } from '../redis/redis.module';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [RedisModule, DatabaseModule],
    providers: [UserPresenceService],
    exports: [UserPresenceService],
})
export class UserPresenceModule { }
