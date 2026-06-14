import { IsOptional, IsString, MaxLength } from 'class-validator';

/** A batched, in-progress edit broadcast to watchers. Ephemeral — never persisted. */
export class DraftDto {
    @IsOptional()
    @IsString()
    @MaxLength(300)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10000)
    description?: string;
}
