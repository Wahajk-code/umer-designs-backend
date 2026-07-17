import { IsDateString, IsOptional, IsUrl } from 'class-validator';

export class ConfirmMeetingDto {
  @IsUrl()
  link!: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
