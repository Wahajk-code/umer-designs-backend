import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateModificationFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  cloudinaryPublicId!: string;

  @IsIn(['image', 'raw', 'video'])
  resourceType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10)
  format!: string;

  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;
}
