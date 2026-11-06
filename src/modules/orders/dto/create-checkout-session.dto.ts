import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsUUID()
  designId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  addOnIds?: string[];

  /** Plan changes bought together with the plan; tracked as a request after payment. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  modificationOptionIds?: string[];
}
