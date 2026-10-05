import {
  ENDPOINT_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  type EndpointType,
  type NotificationEvent,
} from '@orchestrator/shared-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateEndpointDto {
  @IsIn(ENDPOINT_TYPES)
  type!: EndpointType;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsString()
  @MaxLength(1024)
  url!: string;

  @IsArray()
  @ArrayMaxSize(NOTIFICATION_EVENTS.length)
  @IsIn(NOTIFICATION_EVENTS, { each: true })
  events!: NotificationEvent[];
}

export class UpdateEndpointDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  url?: string;

  @IsOptional()
  @IsArray()
  @IsIn(NOTIFICATION_EVENTS, { each: true })
  events?: NotificationEvent[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class MarkReadDto {
  /** Omit to mark everything read. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids?: string[];
}

export class PreferenceDto {
  @IsIn(NOTIFICATION_EVENTS)
  event!: NotificationEvent;

  @IsArray()
  @IsIn(NOTIFICATION_CHANNELS, { each: true })
  channels!: Array<(typeof NOTIFICATION_CHANNELS)[number]>;
}

export class UpdatePreferencesDto {
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_EVENTS.length)
  @ValidateNested({ each: true })
  @Type(() => PreferenceDto)
  preferences!: PreferenceDto[];
}

class PushKeysDto {
  @IsString()
  @MaxLength(255)
  p256dh!: string;

  @IsString()
  @MaxLength(255)
  auth!: string;
}

export class PushSubscriptionDto {
  @IsString()
  @MaxLength(2048)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

export class PushUnsubscribeDto {
  @IsString()
  @MaxLength(2048)
  endpoint!: string;
}
