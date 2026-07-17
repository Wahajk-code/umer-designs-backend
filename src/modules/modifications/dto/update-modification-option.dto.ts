import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateModificationOptionDto } from '@/modules/modifications/dto/create-modification-option.dto';

export class UpdateModificationOptionDto extends PartialType(CreateModificationOptionDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
