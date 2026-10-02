import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchDecisionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  serviceName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
