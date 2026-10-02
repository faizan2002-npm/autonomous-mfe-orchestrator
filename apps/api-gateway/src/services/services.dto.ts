import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateServiceDto {
  /** Used in proxy URLs: /api/v1/<serviceName>/... */
  @Matches(/^[a-z0-9][a-z0-9-]{0,62}$/, {
    message:
      'serviceName must be lowercase letters, digits and dashes (max 63)',
  })
  serviceName!: string;

  @IsString()
  @MaxLength(512)
  baseUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Matches(/^\/[^\s]*$/, { message: 'healthPath must start with /' })
  @MaxLength(255)
  healthPath?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(60_000)
  timeoutMs?: number;

  /** Sent with every upstream request (e.g. Authorization); stored encrypted. */
  @IsOptional()
  @IsObject()
  upstreamHeaders?: Record<string, string>;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Matches(/^(\/[^\s]*)?$/, {
    message: 'healthPath must start with / (or be empty)',
  })
  @MaxLength(255)
  healthPath?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(60_000)
  timeoutMs?: number;

  /** Replaces all upstream headers; {} removes them. */
  @IsOptional()
  @IsObject()
  upstreamHeaders?: Record<string, string>;
}
