import {
  CONSUMER_KINDS,
  KEY_TYPES,
  type ConsumerKind,
  type KeyType,
} from '@orchestrator/shared-types';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const ORIGIN = /^https?:\/\/[^/\s?#]+$/;

export class CreateConsumerDto {
  @Matches(/^[a-z0-9][a-z0-9-]{0,62}$/, {
    message: 'name must be lowercase letters, digits and dashes (max 63)',
  })
  name!: string;

  @IsIn(CONSUMER_KINDS)
  kind!: ConsumerKind;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  serviceIds?: string[];
}

export class UpdateConsumerDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Replaces the services this consumer may call. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  serviceIds?: string[];
}

export class IssueKeyDto {
  @IsIn(KEY_TYPES)
  type!: KeyType;

  /** Required for publishable keys: browser origins such as https://app.example.com */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(ORIGIN, {
    each: true,
    message: 'each origin must look like https://host[:port]',
  })
  allowedOrigins?: string[];
}
