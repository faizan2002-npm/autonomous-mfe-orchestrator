import { ORG_ROLES, type OrgRole } from '@orchestrator/shared-types';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOrgDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /** Used in URLs: lowercase letters, digits and dashes. */
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, {
    message:
      'slug must be 3-48 lowercase letters, digits or dashes, not starting or ending with a dash',
  })
  slug!: string;
}

export class UpdateOrgSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  driftThreshold?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  canaryPercent?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  geminiModel?: string;

  /** Empty string removes the stored key. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  geminiApiKey?: string;
}

export class InviteMemberDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsIn(ORG_ROLES)
  role!: OrgRole;
}

export class UpdateMemberDto {
  @IsIn(ORG_ROLES)
  role!: OrgRole;
}
