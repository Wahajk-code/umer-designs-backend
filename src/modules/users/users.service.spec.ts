import { Role } from '@prisma/client';
import { UsersService } from '@/modules/users/users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    service = new UsersService(prisma as any);
  });

  it('generates a referral code derived from the first name and retries on collision', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'existing' }) // first candidate collides
      .mockResolvedValueOnce(null); // second candidate is free
    prisma.user.create.mockImplementation(async (args) => ({ id: 'u1', ...args.data }));

    const user = await service.create({
      email: 'sofia@example.com',
      passwordHash: 'hashed',
      firstName: 'Sofia',
      lastName: 'Haddad',
    });

    expect(user.referralCode).toMatch(/^SOFIA-[0-9A-F]{6}$/);
  });

  it('falls back to UMER when the first name has no letters', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async (args) => ({ id: 'u1', ...args.data }));

    const user = await service.create({
      email: 'x@example.com',
      passwordHash: 'hashed',
      firstName: '123',
      lastName: 'Y',
    });

    expect(user.referralCode).toMatch(/^UMER-[0-9A-F]{6}$/);
  });

  it('lowercases email on lookup', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await service.findByEmail('Foo@Example.com');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'foo@example.com' } });
  });

  it('promotes a user to a new role', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1', role: Role.ADMIN });
    const user = await service.promoteToRole('u1', Role.ADMIN);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: Role.ADMIN },
    });
    expect(user.role).toBe(Role.ADMIN);
  });

  it('paginates the user list and returns the total count', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    prisma.user.count.mockResolvedValue(42);

    const result = await service.list(2, 10);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(result.total).toBe(42);
    expect(result.users).toHaveLength(2);
  });
});
