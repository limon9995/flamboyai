import { AssistantToolsService } from './assistant-tools.service';

describe('AssistantToolsService', () => {
  const product = { id: 1, pageId: 7, code: 'DF-0001', name: 'Blue Kurti', price: 900, stockQty: 5, originalPrice: null, isActive: true };
  let prisma: any;
  let dashboard: any;
  let svc: AssistantToolsService;

  beforeEach(() => {
    prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(product) },
      page: { findUnique: jest.fn().mockResolvedValue({ id: 7, automationOn: true, deliveryFeeInsideDhaka: 80, knowledgeText: 'Old fact' }) },
      order: { findFirst: jest.fn().mockResolvedValue({ id: 42, status: 'RECEIVED', customerName: 'Rahim' }) },
    };
    dashboard = {
      updateProduct: jest.fn().mockResolvedValue({}),
      updateModes: jest.fn().mockResolvedValue({}),
      updateBusinessSettings: jest.fn().mockResolvedValue({}),
      applyOrderAction: jest.fn().mockResolvedValue({}),
    };
    svc = new AssistantToolsService(prisma, dashboard, {} as any);
  });

  it('previews a product change without writing anything', async () => {
    const a = await svc.preview(7, 'update_product', { code: 'df-0001', price: '950', stockDelta: 10 });
    expect(a.params).toEqual({ code: 'DF-0001', price: 950, stockQty: 15 });
    expect(a.changes.map((c) => c.label)).toEqual(['দাম (৳)', 'স্টক']);
    expect(dashboard.updateProduct).not.toHaveBeenCalled();
  });

  it('drops fields outside the whitelist', async () => {
    const a = await svc.preview(7, 'update_product', { code: 'DF-0001', price: 950, pageId: 99, imageUrl: 'x' });
    expect(a.params).toEqual({ code: 'DF-0001', price: 950 });
  });

  it('rejects a no-op change', async () => {
    await expect(svc.preview(7, 'update_product', { code: 'DF-0001', price: 900 })).rejects.toThrow();
  });

  it('routes mode and business settings to the right service calls on execute', async () => {
    await svc.execute(7, { type: 'update_settings', params: { automationOn: false, deliveryFeeInsideDhaka: '70', waToken: 'evil' } });
    expect(dashboard.updateModes).toHaveBeenCalledWith(7, { automationOn: false });
    expect(dashboard.updateBusinessSettings).toHaveBeenCalledWith(7, { deliveryFeeInsideDhaka: 70 });
  });

  it('appends bot knowledge instead of replacing it', async () => {
    await svc.execute(7, { type: 'add_bot_knowledge', params: { text: 'Shop closes at 10pm' } });
    expect(dashboard.updateBusinessSettings).toHaveBeenCalledWith(7, { knowledgeText: 'Old fact\nShop closes at 10pm' });
  });

  it('only acts on orders belonging to the page', async () => {
    prisma.order.findFirst.mockResolvedValueOnce(null);
    await expect(svc.execute(7, { type: 'order_action', params: { orderId: 1, action: 'cancel' } })).rejects.toThrow();
    expect(dashboard.applyOrderAction).not.toHaveBeenCalled();
    expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, pageIdRef: 7 } }));
  });

  it('refuses unknown action types', async () => {
    await expect(svc.execute(7, { type: 'delete_everything', params: {} })).rejects.toThrow();
  });
});
