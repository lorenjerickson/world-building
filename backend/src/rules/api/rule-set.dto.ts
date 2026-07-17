import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const ruleDefinitionTypes = [
  'entity-type',
  'trait',
  'field',
  'derived-value',
  'modifier',
  'check',
  'resource',
  'catalog',
  'template',
  'operation',
  'effect',
  'event',
  'constraint',
  'presentation',
  'fixture',
] as const;

export type RuleDefinitionType = typeof ruleDefinitionTypes[number];

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const namespacePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export class ListRuleSetsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(['active', 'deprecated', 'retired'])
  lifecycle?: 'active' | 'deprecated' | 'retired';

  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';

  @IsOptional()
  @Matches(/^\d+$/)
  page?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  limit?: string;
}

export class CreateRuleSetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @Matches(slugPattern)
  @MaxLength(120)
  slug: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  summary: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  engineFeatureLevel: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  accentColor?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class UpdateRuleSetDto {
  @IsString()
  @IsISO8601({ strict: true })
  expectedUpdatedAt: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(slugPattern)
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsIn(['active', 'deprecated', 'retired'])
  lifecycle?: 'active' | 'deprecated' | 'retired';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  engineFeatureLevel?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  accentColor?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class CreateRuleModuleDto {
  @IsString()
  @Matches(namespacePattern)
  @MaxLength(120)
  namespace: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requiredEngineFeatureLevel?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  dependencies?: unknown[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  exports?: unknown[];
}

export class UpdateRuleModuleDto {
  @IsString()
  @IsISO8601({ strict: true })
  expectedUpdatedAt: string;

  @IsOptional()
  @IsString()
  @Matches(namespacePattern)
  @MaxLength(120)
  namespace?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requiredEngineFeatureLevel?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  dependencies?: unknown[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  exports?: unknown[];
}

export class ListRuleDefinitionsQueryDto {
  @IsOptional()
  @IsIn(ruleDefinitionTypes)
  type?: RuleDefinitionType;

  @IsOptional()
  @Matches(/^\d+$/)
  moduleId?: string;
}

export class CreateRuleDefinitionDto {
  @IsInt()
  @Min(1)
  moduleId: number;

  @IsIn(ruleDefinitionTypes)
  definitionType: RuleDefinitionType;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  schemaVersion?: number;

  @IsOptional()
  @IsIn(['exported', 'private'])
  visibility?: 'exported' | 'private';

  @IsObject()
  body: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  presentation?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];
}

export class UpdateRuleDefinitionDto {
  @IsString()
  @IsISO8601({ strict: true })
  expectedUpdatedAt: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  moduleId?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  schemaVersion?: number;

  @IsOptional()
  @IsIn(['exported', 'private'])
  visibility?: 'exported' | 'private';

  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  presentation?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];
}

export class CloneRuleDefinitionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetModuleId?: number;
}
