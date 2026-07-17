import { Injectable, NotFoundException } from '@nestjs/common';
import { ModificationOption } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { CreateModificationOptionDto } from '@/modules/modifications/dto/create-modification-option.dto';
import { UpdateModificationOptionDto } from '@/modules/modifications/dto/update-modification-option.dto';

@Injectable()
export class ModificationOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  listActive(): Promise<ModificationOption[]> {
    return this.prisma.modificationOption.findMany({
      where: { active: true },
      orderBy: { addedCostCents: 'asc' },
    });
  }

  listAll(): Promise<ModificationOption[]> {
    return this.prisma.modificationOption.findMany({ orderBy: { createdAt: 'desc' } });
  }

  create(dto: CreateModificationOptionDto): Promise<ModificationOption> {
    return this.prisma.modificationOption.create({
      data: { label: dto.label, description: dto.description, addedCostCents: dto.addedCostCents },
    });
  }

  async update(id: string, dto: UpdateModificationOptionDto): Promise<ModificationOption> {
    const existing = await this.prisma.modificationOption.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Modification option not found.');
    }
    return this.prisma.modificationOption.update({
      where: { id },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.addedCostCents !== undefined && { addedCostCents: dto.addedCostCents }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  async findManyByIds(ids: string[]): Promise<ModificationOption[]> {
    const options = await this.prisma.modificationOption.findMany({ where: { id: { in: ids } } });
    return options;
  }
}
