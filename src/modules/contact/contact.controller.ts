import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ContactService } from '@/modules/contact/contact.service';
import { CreateContactMessageDto } from '@/modules/contact/dto/create-contact-message.dto';
import { Public } from '@/common/decorators/public.decorator';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ auth: {} })
  async submit(@Body() dto: CreateContactMessageDto): Promise<void> {
    await this.contactService.submit(dto);
  }
}
