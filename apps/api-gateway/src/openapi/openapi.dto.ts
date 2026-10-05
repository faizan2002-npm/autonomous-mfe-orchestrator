import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

/** Exactly one of `document` (JSON or YAML text, or a parsed object) and `url`. */
export class ImportOpenApiDto {
  @ValidateIf((dto: ImportOpenApiDto) => dto.url === undefined)
  document?: string | Record<string, unknown>;

  @ValidateIf((dto: ImportOpenApiDto) => dto.document === undefined)
  @IsString()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsBoolean()
  requiredOnly?: boolean;
}

export class AdoptContractDto {
  @IsUUID()
  contractId!: string;
}
