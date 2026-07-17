import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Design, DesignFile, DesignStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { CloudinaryService } from '@/modules/cloudinary/cloudinary.service';
import { CreateDesignDto } from '@/modules/designs/dto/create-design.dto';
import { UpdateDesignDto } from '@/modules/designs/dto/update-design.dto';
import { ListDesignsQueryDto } from '@/modules/designs/dto/list-designs-query.dto';
import { CreateDesignFileDto } from '@/modules/designs/dto/create-design-file.dto';
import { slugify } from '@/common/utils/slugify.util';

type DesignWithFiles = Design & { files: DesignFile[] };

@Injectable()
export class DesignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async listPublished(query: ListDesignsQueryDto): Promise<{ designs: Design[]; total: number }> {
    const where = this.buildWhere(query, DesignStatus.PUBLISHED);
    const [designs, total] = await this.prisma.$transaction([
      this.prisma.design.findMany({
        where,
        orderBy: this.buildOrderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.design.count({ where }),
    ]);
    return { designs, total };
  }

  async findPublishedBySlug(slug: string): Promise<DesignWithFiles> {
    const design = await this.prisma.design.findUnique({
      where: { slug },
      include: { files: true },
    });
    if (!design || design.status !== DesignStatus.PUBLISHED) {
      throw new NotFoundException('Design not found.');
    }
    return design;
  }

  async listAdmin(query: ListDesignsQueryDto): Promise<{ designs: Design[]; total: number }> {
    const where = this.buildWhere(query, undefined);
    const [designs, total] = await this.prisma.$transaction([
      this.prisma.design.findMany({
        where,
        orderBy: this.buildOrderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.design.count({ where }),
    ]);
    return { designs, total };
  }

  async findByIdAdmin(id: string): Promise<DesignWithFiles> {
    const design = await this.prisma.design.findUnique({ where: { id }, include: { files: true } });
    if (!design) {
      throw new NotFoundException('Design not found.');
    }
    return design;
  }

  async create(dto: CreateDesignDto): Promise<Design> {
    const slug = await this.generateUniqueSlug(dto.title);
    return this.prisma.design.create({
      data: {
        title: dto.title,
        slug,
        category: dto.category,
        basePriceCents: dto.basePriceCents,
        bedrooms: dto.bedrooms,
        bathrooms: dto.bathrooms,
        sqft: dto.sqft,
        estimatedBuildCents: dto.estimatedBuildCents,
        summary: dto.summary,
        description: dto.description,
        coverImageUrl: dto.coverImageUrl,
        galleryUrls: dto.galleryUrls ?? [],
      },
    });
  }

  async update(id: string, dto: UpdateDesignDto): Promise<Design> {
    await this.findByIdAdmin(id);
    return this.prisma.design.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.basePriceCents !== undefined && { basePriceCents: dto.basePriceCents }),
        ...(dto.bedrooms !== undefined && { bedrooms: dto.bedrooms }),
        ...(dto.bathrooms !== undefined && { bathrooms: dto.bathrooms }),
        ...(dto.sqft !== undefined && { sqft: dto.sqft }),
        ...(dto.estimatedBuildCents !== undefined && {
          estimatedBuildCents: dto.estimatedBuildCents,
        }),
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.coverImageUrl !== undefined && { coverImageUrl: dto.coverImageUrl }),
        ...(dto.galleryUrls !== undefined && { galleryUrls: dto.galleryUrls }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  createUploadSignature(designId: string) {
    return this.cloudinary.createUploadSignature(`designs/${designId}`);
  }

  async addFile(designId: string, dto: CreateDesignFileDto): Promise<DesignFile> {
    await this.findByIdAdmin(designId);
    return this.prisma.designFile.create({
      data: {
        designId,
        label: dto.label,
        cloudinaryPublicId: dto.cloudinaryPublicId,
        resourceType: dto.resourceType,
        format: dto.format,
      },
    });
  }

  async removeFile(designId: string, fileId: string): Promise<void> {
    const file = await this.prisma.designFile.findFirst({ where: { id: fileId, designId } });
    if (!file) {
      throw new NotFoundException('File not found.');
    }
    await this.cloudinary
      .deleteAsset(file.cloudinaryPublicId, file.resourceType)
      .catch(() => undefined);
    await this.prisma.designFile.delete({ where: { id: fileId } });
  }

  private buildWhere(
    query: ListDesignsQueryDto,
    forcedStatus: DesignStatus | undefined,
  ): Prisma.DesignWhereInput {
    return {
      ...(forcedStatus && { status: forcedStatus }),
      ...(query.category && { category: query.category }),
      ...(query.minBedrooms !== undefined && { bedrooms: { gte: query.minBedrooms } }),
      ...(query.maxPriceCents !== undefined && { basePriceCents: { lte: query.maxPriceCents } }),
      ...(query.search && { title: { contains: query.search, mode: 'insensitive' } }),
    };
  }

  private buildOrderBy(sort?: string): Prisma.DesignOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { basePriceCents: 'asc' };
      case 'price_desc':
        return { basePriceCents: 'desc' };
      default:
        return { createdAt: 'desc' };
    }
  }

  private async generateUniqueSlug(title: string): Promise<string> {
    const base = slugify(title) || 'design';
    let candidate = base;
    let attempt = 1;
    while (await this.prisma.design.findUnique({ where: { slug: candidate } })) {
      attempt += 1;
      candidate = `${base}-${attempt}`;
      if (attempt > 50) {
        throw new ConflictException('Could not generate a unique slug for this design.');
      }
    }
    return candidate;
  }
}
