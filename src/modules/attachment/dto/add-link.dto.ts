import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class AddLinkDto {
    @IsUrl({ require_protocol: true })
    url: string;

    @IsOptional()
    @IsString()
    @MaxLength(300)
    name?: string;
}
