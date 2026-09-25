import { BadRequestException } from '@nestjs/common';
import { CourierService } from './courier.service';
import { EncryptionService } from '../common/encryption.service';

describe('CourierService — Pathao credentials', () => {
  let service: CourierService;
  let encryption: EncryptionService;

  beforeEach(() => {
    encryption = new EncryptionService();
    service = new CourierService(
      {} as any, // PrismaService — unused by the methods under test
      {} as any, // OrderNotificationService — unused by the methods under test
      encryption,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('normalizeSettings', () => {
    it('encrypts a freshly-submitted Pathao password', () => {
      const result: any = (service as any).normalizeSettings({
        pathao: { apiKey: 'id', secretKey: 'secret', username: 'merchant@example.com', password: 'plain-password' },
      });

      expect(result.pathao.username).toBe('merchant@example.com');
      expect(result.pathao.password).not.toBe('plain-password');
      expect(result.pathao.password).toMatch(/^ENC:/);
      expect(encryption.decrypt(result.pathao.password)).toBe('plain-password');
    });

    it('preserves the existing encrypted password when the client resubmits the ***SAVED*** mask', () => {
      const existing: any = (service as any).normalizeSettings({
        pathao: { apiKey: 'id', secretKey: 'secret', username: 'merchant@example.com', password: 'plain-password' },
      });

      const resaved: any = (service as any).normalizeSettings(
        { pathao: { apiKey: 'id', secretKey: 'secret', username: 'merchant@example.com', password: '***SAVED***' } },
        existing,
      );

      expect(resaved.pathao.password).toBe(existing.pathao.password);
      expect(encryption.decrypt(resaved.pathao.password)).toBe('plain-password');
    });

    it('does not double-encrypt an already-encrypted password read back from disk', () => {
      const first: any = (service as any).normalizeSettings({
        pathao: { apiKey: 'id', secretKey: 'secret', password: 'plain-password' },
      });
      const reread: any = (service as any).normalizeSettings(first);

      expect(reread.pathao.password).toBe(first.pathao.password);
      expect(encryption.decrypt(reread.pathao.password)).toBe('plain-password');
    });
  });

  describe('maskSettings', () => {
    it('masks a set Pathao password and leaves an unset one blank', () => {
      const withPassword: any = (service as any).maskSettings({
        pathao: { apiKey: 'id', secretKey: 'secret', password: 'ENC:xxx' },
      });
      expect(withPassword.pathao.password).toBe('***SAVED***');

      const withoutPassword: any = (service as any).maskSettings({
        pathao: { apiKey: 'id', secretKey: 'secret', password: '' },
      });
      expect(withoutPassword.pathao.password).toBe('');
    });
  });

  describe('bookPathao', () => {
    const baseInput = {
      orderId: 1,
      pageId: 1,
      courier: 'pathao' as const,
      recipientName: 'Customer',
      recipientPhone: '01700000000',
      recipientAddress: 'Dhaka',
      codAmount: 500,
    };

    it('rejects when Client ID/Secret are missing', async () => {
      await expect(
        (service as any).bookPathao({ apiKey: '', secretKey: '' }, baseInput),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when Merchant Username/Password are missing even if Client ID/Secret are set', async () => {
      await expect(
        (service as any).bookPathao(
          { apiKey: 'id', secretKey: 'secret', username: '', password: '' },
          baseInput,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sends username and the decrypted password to the Pathao token endpoint', async () => {
      const encryptedPassword = encryption.encrypt('merchant-password');
      const postSpy = jest.spyOn(require('axios'), 'post')
        .mockResolvedValueOnce({ data: { access_token: 'token-123' } } as any)
        .mockResolvedValueOnce({ data: { data: { consignment_id: 'CID-1' } } } as any);

      const result = await (service as any).bookPathao(
        {
          apiKey: 'client-id',
          secretKey: 'client-secret',
          storeId: 'store-1',
          username: 'merchant@example.com',
          password: encryptedPassword,
        },
        baseInput,
      );

      expect(postSpy).toHaveBeenNthCalledWith(
        1,
        'https://api-hermes.pathao.com/aladdin/api/v1/issue-token',
        expect.objectContaining({
          client_id: 'client-id',
          client_secret: 'client-secret',
          grant_type: 'password',
          username: 'merchant@example.com',
          password: 'merchant-password',
        }),
        expect.anything(),
      );
      expect(result.trackingId).toBe('CID-1');
    });
  });

  describe('fetchLiveTrackingStatus', () => {
    it('returns the Steadfast delivery_status', async () => {
      jest.spyOn(require('axios'), 'get').mockResolvedValueOnce({
        data: { delivery_status: 'in_transit' },
      } as any);

      const result = await service.fetchLiveTrackingStatus(
        'steadfast',
        { steadfast: { apiKey: 'k', secretKey: 's' } } as any,
        'trk-1',
      );

      expect(result.status).toBe('in_transit');
    });

    it('fetches a Pathao token then returns order_status from the tracking endpoint', async () => {
      const encryptedPassword = encryption.encrypt('merchant-password');
      const getSpy = jest.spyOn(require('axios'), 'get').mockResolvedValueOnce({
        data: { data: { order_status: 'Delivered' } },
      } as any);
      jest.spyOn(require('axios'), 'post').mockResolvedValueOnce({
        data: { access_token: 'token-123' },
      } as any);

      const result = await service.fetchLiveTrackingStatus(
        'pathao',
        {
          pathao: {
            apiKey: 'id', secretKey: 'secret',
            username: 'merchant@example.com', password: encryptedPassword,
          },
        } as any,
        'CID-1',
      );

      expect(getSpy).toHaveBeenCalledWith(
        'https://api-hermes.pathao.com/aladdin/api/v1/orders/CID-1/info',
        expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } }),
      );
      expect(result.status).toBe('Delivered');
    });

    it('resolves to a null status instead of throwing when credentials are missing', async () => {
      const result = await service.fetchLiveTrackingStatus(
        'pathao',
        { pathao: { apiKey: '', secretKey: '' } } as any,
        'CID-1',
      );
      expect(result.status).toBeNull();
    });

    it('resolves to a null status instead of throwing on a network error', async () => {
      jest.spyOn(require('axios'), 'get').mockRejectedValueOnce(new Error('timeout'));
      const result = await service.fetchLiveTrackingStatus(
        'steadfast',
        { steadfast: { apiKey: 'k', secretKey: 's' } } as any,
        'trk-1',
      );
      expect(result.status).toBeNull();
    });
  });

  describe('liveStatusLabel', () => {
    it('maps known statuses to Bengali labels', () => {
      expect(service.liveStatusLabel('delivered')).toBe('🎉 ডেলিভারি সম্পন্ন');
      expect(service.liveStatusLabel('in_transit')).toBe('🚚 পথে আছে');
    });
    it('passes through unknown statuses with a generic prefix', () => {
      expect(service.liveStatusLabel('weird_status')).toBe('🚚 weird_status');
    });
    it('returns null for a null/empty status', () => {
      expect(service.liveStatusLabel(null)).toBeNull();
    });
  });
});
