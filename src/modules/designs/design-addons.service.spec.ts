import { NotFoundException } from '@nestjs/common';
import { DesignAddOnsService } from '@/modules/designs/design-addons.service';

describe('DesignAddOnsService', () => {
  let service: DesignAddOnsService;
  let prisma: {
    design: { findUnique: jest.Mock };
    designAddOn: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      design: { findUnique: jest.fn() },
      designAddOn: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    service = new DesignAddOnsService(prisma as any);
  });

  it('listActive only returns active add-ons for the given design, cheapest first', async () => {
    prisma.designAddOn.findMany.mockResolvedValue([]);
    await service.listActive('design-1');
    expect(prisma.designAddOn.findMany).toHaveBeenCalledWith({
      where: { designId: 'design-1', active: true },
      orderBy: { addedCostCents: 'asc' },
    });
  });

  it('create throws 404 for a design that does not exist', async () => {
    prisma.design.findUnique.mockResolvedValue(null);
    await expect(
      service.create('missing-design', { label: 'Garage', addedCostCents: 8000 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('update only writes provided fields', async () => {
    prisma.designAddOn.findFirst.mockResolvedValue({ id: 'addon-1', designId: 'design-1' });
    prisma.designAddOn.update.mockResolvedValue({ id: 'addon-1', active: false });

    await service.update('design-1', 'addon-1', { active: false });

    expect(prisma.designAddOn.update).toHaveBeenCalledWith({
      where: { id: 'addon-1' },
      data: { active: false },
    });
  });

  it('update throws 404 when the add-on does not belong to this design', async () => {
    prisma.designAddOn.findFirst.mockResolvedValue(null);
    await expect(
      service.update('design-1', 'addon-from-another-design', { active: false }),
    ).rejects.toThrow(NotFoundException);
  });
});
