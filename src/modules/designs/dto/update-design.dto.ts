import { PartialType } from '@nestjs/swagger';
import { DesignStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateDesignDto } from '@/modules/designs/dto/create-design.dto';

export class UpdateDesignDto extends PartialType(CreateDesignDto) {
  @IsOptional()
  @IsEnum(DesignStatus)
  status?: DesignStatus;
}
