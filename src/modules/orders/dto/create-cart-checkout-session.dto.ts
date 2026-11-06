import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CartCheckoutItemDto {
  @IsUUID()
  designId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  addOnIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  modificationOptionIds?: string[];
}

export class CreateCartCheckoutSessionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CartCheckoutItemDto)
  items!: CartCheckoutItemDto[];
}
