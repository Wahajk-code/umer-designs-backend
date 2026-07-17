import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Design } from '@prisma/client';
import { DesignsService } from '@/modules/designs/designs.service';
import { ListDesignsQueryDto } from '@/modules/designs/dto/list-designs-query.dto';
import { Public } from '@/common/decorators/public.decorator';

/**
 * Public storefront listings. "Public" here means public-through-the-BFF —
 * every request still passes the global InternalAttestationGuard, it's just
 * that no user JWT is required (@Public skips JwtAuthGuard only).
 */
@ApiTags('designs')
@Controller('designs')
export class DesignsController {
  constructor(private readonly designsService: DesignsService) {}

  @Public()
  @Get()
  async list(
    @Query() query: ListDesignsQueryDto,
  ): Promise<{ designs: Design[]; total: number; page: number; pageSize: number }> {
    const { designs, total } = await this.designsService.listPublished(query);
    return { designs, total, page: query.page, pageSize: query.pageSize };
  }

  @Public()
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.designsService.findPublishedBySlug(slug);
  }
}
