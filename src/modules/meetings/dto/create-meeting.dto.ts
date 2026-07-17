import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateMeetingDto {
  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsUUID()
  modificationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
