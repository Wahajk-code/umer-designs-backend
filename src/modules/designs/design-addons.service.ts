import { Injectable, NotFoundException } from '@nestjs/common';
import { DesignAddOn } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { CreateDesignAddOnDto } from '@/modules/designs/dto/create-design-addon.dto';
import { UpdateDesignAddOnDto } from '@/modules/designs/dto/update-design-addon.dto';

@Injectable()
export class DesignAddOnsService {
  constructor(private readonly prisma: PrismaService) {}

  listActive(designId: string): Promise<DesignAddOn[]> {
    return this.prisma.designAddOn.findMany({
      where: { designId, active: true },
      orderBy: { addedCostCents: 'asc' },
    });
  }

  listAll(designId: string): Promise<DesignAddOn[]> {
    return this.prisma.designAddOn.findMany({
      where: { designId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(designId: string, dto: CreateDesignAddOnDto): Promise<DesignAddOn> {
    const design = await this.prisma.design.findUnique({ where: { id: designId } });
    if (!design) {
      throw new NotFoundException('Design not found.');
    }
    return this.prisma.designAddOn.create({
      data: {
        designId,
        label: dto.label,
        description: dto.description,
        addedCostCents: dto.addedCostCents,
      },
    });
  }

  async update(designId: string, id: string, dto: UpdateDesignAddOnDto): Promise<DesignAddOn> {
    const existing = await this.prisma.designAddOn.findFirst({ where: { id, designId } });
    if (!existing) {
      throw new NotFoundException('Design add-on not found.');
    }
    return this.prisma.designAddOn.update({
      where: { id },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.addedCostCents !== undefined && { addedCostCents: dto.addedCostCents }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  async findManyByIds(designId: string, ids: string[]): Promise<DesignAddOn[]> {
    const addOns = await this.prisma.designAddOn.findMany({
      where: { id: { in: ids }, designId },
    });
    return addOns;
  }
}
