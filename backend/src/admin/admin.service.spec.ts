import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: {
    user: { findUnique: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
    };

    service = new AdminService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  describe('clientDetails', () => {
    it('throws when user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.clientDetails('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when requested user is not a client', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
        username: 'admin',
        name: 'Admin',
        email: 'admin@example.com',
        pages: [],
      });

      await expect(service.clientDetails('admin-1')).rejects.toThrow(
        'Client not found',
      );
    });

    it('returns client details for client users only', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'client-1',
        role: 'client',
        username: 'limon',
        name: 'Limon',
        email: 'limon@example.com',
        pages: [{ id: 1, pageId: 'p1', pageName: 'Demo Store' }],
      });

      await expect(service.clientDetails('client-1')).resolves.toEqual({
        id: 'client-1',
        username: 'limon',
        name: 'Limon',
        email: 'limon@example.com',
        pages: [{ id: 1, pageId: 'p1', pageName: 'Demo Store' }],
      });
    });
  });
});
