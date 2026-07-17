import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class CreateModificationCheckoutDto {
  @IsUUID()
  designId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  selectedOptionIds!: string[];
}
