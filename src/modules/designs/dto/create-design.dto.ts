import { DesignCategory } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateDesignDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @IsEnum(DesignCategory)
  category!: DesignCategory;

  @IsInt()
  @Min(0)
  basePriceCents!: number;

  @IsInt()
  @Min(0)
  @Max(20)
  bedrooms!: number;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(20)
  bathrooms!: number;

  @IsInt()
  @Min(1)
  sqft!: number;

  @IsInt()
  @Min(0)
  estimatedBuildCents!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(280)
  summary!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  description!: string;

  @IsUrl()
  coverImageUrl!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUrl({}, { each: true })
  galleryUrls?: string[];
}
