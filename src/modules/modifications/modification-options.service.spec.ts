import { ModificationOptionsService } from '@/modules/modifications/modification-options.service';

describe('ModificationOptionsService', () => {
  let service: ModificationOptionsService;
  let prisma: {
    modificationOption: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      modificationOption: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    service = new ModificationOptionsService(prisma as any);
  });

  it('listActive only returns active options, cheapest first', async () => {
    prisma.modificationOption.findMany.mockResolvedValue([]);
    await service.listActive();
    expect(prisma.modificationOption.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { addedCostCents: 'asc' },
    });
  });

  it('update only writes provided fields', async () => {
    prisma.modificationOption.findUnique.mockResolvedValue({ id: 'opt-1' });
    prisma.modificationOption.update.mockResolvedValue({ id: 'opt-1', active: false });

    await service.update('opt-1', { active: false });

    expect(prisma.modificationOption.update).toHaveBeenCalledWith({
      where: { id: 'opt-1' },
      data: { active: false },
    });
  });
});
