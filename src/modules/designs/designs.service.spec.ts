import { NotFoundException } from '@nestjs/common';
import { DesignCategory, DesignStatus } from '@prisma/client';
import { DesignsService } from '@/modules/designs/designs.service';
import { CloudinaryService } from '@/modules/cloudinary/cloudinary.service';

describe('DesignsService', () => {
  let service: DesignsService;
  let prisma: {
    design: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    designFile: { create: jest.Mock; findFirst: jest.Mock; delete: jest.Mock };
    $transaction: jest.Mock;
  };
  let cloudinary: jest.Mocked<Pick<CloudinaryService, 'createUploadSignature' | 'deleteAsset'>>;

  const baseQuery = { page: 1, pageSize: 12 } as any;

  beforeEach(() => {
    prisma = {
      design: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      designFile: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    cloudinary = {
      createUploadSignature: jest.fn(),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
    };
    service = new DesignsService(prisma as any, cloudinary as any);
  });

  describe('listPublished', () => {
    it('always scopes to PUBLISHED status regardless of caller intent', async () => {
      prisma.design.findMany.mockResolvedValue([]);
      prisma.design.count.mockResolvedValue(0);

      await service.listPublished(baseQuery);

      expect(prisma.design.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: DesignStatus.PUBLISHED }),
        }),
      );
    });

    it('applies category, bedroom, price, and search filters', async () => {
      prisma.design.findMany.mockResolvedValue([]);
      prisma.design.count.mockResolvedValue(0);

      await service.listPublished({
        ...baseQuery,
        category: DesignCategory.CONTAINER,
        minBedrooms: 2,
        maxPriceCents: 200000,
        search: 'meridian',
      });

      expect(prisma.design.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: DesignCategory.CONTAINER,
            bedrooms: { gte: 2 },
            basePriceCents: { lte: 200000 },
            title: { contains: 'meridian', mode: 'insensitive' },
          }),
        }),
      );
    });
  });

  describe('findPublishedBySlug', () => {
    it('throws 404 when the design does not exist', async () => {
      prisma.design.findUnique.mockResolvedValue(null);
      await expect(service.findPublishedBySlug('nope')).rejects.toThrow(NotFoundException);
    });

    it('throws 404 for a draft/hidden design (does not leak unpublished listings)', async () => {
      prisma.design.findUnique.mockResolvedValue({
        slug: 'draft-house',
        status: DesignStatus.DRAFT,
      });
      await expect(service.findPublishedBySlug('draft-house')).rejects.toThrow(NotFoundException);
    });

    it('returns a published design', async () => {
      prisma.design.findUnique.mockResolvedValue({
        slug: 'the-meridian',
        status: DesignStatus.PUBLISHED,
      });
      const result = await service.findPublishedBySlug('the-meridian');
      expect(result.slug).toBe('the-meridian');
    });
  });

  describe('create', () => {
    const dto = {
      title: 'The Meridian',
      category: DesignCategory.CONTAINER,
      basePriceCents: 145000,
      bedrooms: 2,
      bathrooms: 1,
      sqft: 960,
      estimatedBuildCents: 11800000,
      summary: 'summary',
      description: 'description',
      coverImageUrl: 'https://example.com/cover.jpg',
    };

    it('slugifies the title', async () => {
      prisma.design.findUnique.mockResolvedValue(null);
      prisma.design.create.mockImplementation(async (args) => args.data);

      const design = await service.create(dto as any);
      expect(design.slug).toBe('the-meridian');
    });

    it('appends a numeric suffix on slug collision', async () => {
      prisma.design.findUnique
        .mockResolvedValueOnce({ slug: 'the-meridian' }) // collision
        .mockResolvedValueOnce(null); // free
      prisma.design.create.mockImplementation(async (args) => args.data);

      const design = await service.create(dto as any);
      expect(design.slug).toBe('the-meridian-2');
    });
  });

  describe('update', () => {
    it('only writes the fields provided (partial update)', async () => {
      prisma.design.findUnique.mockResolvedValue({ id: 'd1' });
      prisma.design.update.mockResolvedValue({ id: 'd1', title: 'New Title' });

      await service.update('d1', { title: 'New Title' } as any);

      expect(prisma.design.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { title: 'New Title' },
      });
    });

    it('throws 404 when updating a design that does not exist', async () => {
      prisma.design.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', { title: 'X' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('files', () => {
    it('removeFile deletes the cloudinary asset and the DB row', async () => {
      prisma.designFile.findFirst.mockResolvedValue({
        id: 'f1',
        designId: 'd1',
        cloudinaryPublicId: 'designs/d1/plan',
        resourceType: 'raw',
      });

      await service.removeFile('d1', 'f1');

      expect(cloudinary.deleteAsset).toHaveBeenCalledWith('designs/d1/plan', 'raw');
      expect(prisma.designFile.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    });

    it('removeFile throws 404 for a file that does not belong to the design', async () => {
      prisma.designFile.findFirst.mockResolvedValue(null);
      await expect(service.removeFile('d1', 'not-mine')).rejects.toThrow(NotFoundException);
    });
  });
});
