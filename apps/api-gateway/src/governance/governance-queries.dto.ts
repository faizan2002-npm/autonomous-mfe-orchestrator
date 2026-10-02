import { DRIFT_TYPES, PATCH_STATUSES } from '@orchestrator/shared-types';
import type { DriftType, PatchStatus } from '@orchestrator/shared-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class DriftEventsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  service?: string;

  @IsOptional()
  @IsUUID('4')
  consumerId?: string;

  @IsOptional()
  @IsIn(DRIFT_TYPES)
  type?: DriftType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsISO8601()
  cursor?: string;
}

export class PatchesQuery {
  @IsOptional()
  @IsIn(PATCH_STATUSES)
  status?: PatchStatus;

  @IsOptional()
  @IsUUID('4')
  consumerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  service?: string;
}

export class AuditsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ContractPinsDto {
  /** Field paths the consumer depends on; empty means "all fields". */
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  required!: string[];

  /** Field paths never compared. */
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  ignored!: string[];
}
