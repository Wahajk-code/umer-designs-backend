import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateDesignAddOnDto } from '@/modules/designs/dto/create-design-addon.dto';

export class UpdateDesignAddOnDto extends PartialType(CreateDesignAddOnDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
