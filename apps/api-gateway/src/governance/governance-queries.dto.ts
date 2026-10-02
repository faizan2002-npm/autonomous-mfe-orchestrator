import { DRIFT_TYPES, PATCH_STATUSES } from '@orchestrator/shared-types';
import type { DriftType, PatchStatus } from '@orchestrator/shared-types';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
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
