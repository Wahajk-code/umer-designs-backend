import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsUUID()
  designId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  addOnIds?: string[];
}
