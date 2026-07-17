import { ModificationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStatusDto {
  @IsEnum(ModificationStatus)
  status!: ModificationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
