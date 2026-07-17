import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePaymentLinkDto {
  @IsEmail()
  clientEmail!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsInt()
  @Min(50)
  amountCents!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays: number = 7;
}
