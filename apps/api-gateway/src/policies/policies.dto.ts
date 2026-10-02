import { PATCH_GENERATORS, type PatchGenerator } from '@orchestrator/shared-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdatePolicyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minCanaryRequests?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_080)
  minCanaryMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  maxFailureRate?: number;

  /** null disables automatic rollback. */
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  @Max(1)
  rollbackFailureRate?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  rollbackMinRequests?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PATCH_GENERATORS.length)
  @IsIn(PATCH_GENERATORS, { each: true })
  allowedGenerators?: PatchGenerator[];
}

export class CreatePolicyDto extends UpdatePolicyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  declare name: string;

  /** Omit for every service. */
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  /** Omit for every consumer. */
  @IsOptional()
  @IsUUID()
  consumerId?: string;
}
