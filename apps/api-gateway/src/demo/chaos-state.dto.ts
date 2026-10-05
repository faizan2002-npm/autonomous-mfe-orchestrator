import { IsBoolean } from 'class-validator';

export class ChaosStateDto {
  @IsBoolean()
  mutated!: boolean;
}
