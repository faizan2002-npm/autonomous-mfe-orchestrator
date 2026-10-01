import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PromotePatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  serviceName!: string;
}
