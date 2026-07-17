import { Module } from '@nestjs/common';
import { ContactService } from '@/modules/contact/contact.service';
import { ContactController } from '@/modules/contact/contact.controller';

@Module({
  providers: [ContactService],
  controllers: [ContactController],
})
export class ContactModule {}
