import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateWorldDto {
  @IsString() @MinLength(1) @MaxLength(160)
  name!: string;

  @IsString() @MinLength(1) @MaxLength(10_000)
  description!: string;

  @Type(() => Number) @IsInt() @Min(1)
  ruleSetId!: number;
}

export class CreateWorldEntityDto {
  @IsArray() @IsString({ each: true })
  rootTraitIds!: string[];

  @IsOptional() @IsObject()
  prerequisiteSelections?: Record<string, string[]>;

  @IsObject()
  values!: Record<string, unknown>;
}

export class UpdateWorldEntityDto {
  @IsOptional() @IsObject()
  prerequisiteSelections?: Record<string, string[]>;

  @IsObject()
  values!: Record<string, unknown>;
}

export class AddWorldEntityReferenceDto {
  @IsString() @MinLength(1)
  childEntityId!: string;

  @IsOptional() @IsObject()
  implementationMap?: Record<string, string>;
}

export class CreateCollectionWorldEntityDto extends CreateWorldEntityDto {
  @IsOptional() @IsObject()
  implementationMap?: Record<string, string>;
}

export class ProposeWorldEntityDto {
  @IsArray() @IsString({ each: true })
  rootTraitIds!: string[];

  @IsOptional() @IsObject()
  prerequisiteSelections?: Record<string, string[]>;

  @IsString() @MinLength(1) @MaxLength(20_000)
  prompt!: string;

  @IsOptional() @IsObject()
  currentValues?: Record<string, unknown>;

  @IsOptional() @IsBoolean()
  preserveCurrentValues?: boolean;
}
