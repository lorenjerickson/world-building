import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateElementDto {
  @IsString()
  @IsNotEmpty()
  prompt: string;

  @IsString()
  @IsOptional()
  parentId?: string;
}
