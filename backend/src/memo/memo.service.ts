import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BusinessInfo,
  MemoLayout,
  MemoOrderData,
  MemoPreviewData,
  MemoTheme,
  TemplateFieldMap,
  UploadedMemoTemplate,
} from './memo.types';
import { MemoTemplateService } from './memo-template.service';
import { MemoTemplateAssetService } from './memo-template-asset.service';

@Injectable()
export class MemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memoTemplate: MemoTemplateService,
    private readonly memoAssetService: MemoTemplateAssetService,
  ) {}

  async getOrdersForMemo(ids: number[]): Promise<MemoOrderData[]> {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      include: { items: true },
      orderBy: { id: 'desc' },
    });

    return orders.map((order) => ({
      id: order.id,
      customerName: order.customerName ?? '',
      phone: order.phone ?? '',
      address: order.address ?? '',
      status: order.status ?? '',
      createdAt: order.createdAt?.toISOString?.() ?? new Date().toISOString(),
      items: (order.items || []).map((item) => ({
        productCode: item.productCode || '',
        qty: Number(item.qty ?? 0) || 0,
        unitPrice: Number(item.unitPrice ?? 0) || 0,
      })),
    }));
  }

  async getBusinessInfo(pageId?: number): Promise<BusinessInfo> {
    if (!pageId) {
      return {
        companyName: 'Dress Fashion Zoon',
        phone: '',
        address: '',
        logoUrl: '',
        footerText: 'Thank you for your order',
        deliveryFeeInsideDhaka: 0,
        deliveryFeeOutsideDhaka: 0,
        codLabel: 'COD',
        currencySymbol: '৳',
      };
    }

    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    const p: any = page || {};

    const slug = p.catalogSlug || String(pageId);
    const catalogBaseUrl =
      process.env.CATALOG_BASE_URL || 'https://flamboyai.com';
    const catalogUrl = `${catalogBaseUrl}/catalog/${slug}`;

    return {
      companyName: p.businessName || p.pageName || 'Dress Fashion Zoon',
      phone: p.businessPhone || p.phone || '',
      address: p.businessAddress || p.address || '',
      logoUrl: p.logoUrl || '',
      footerText: p.memoFooterText || 'Thank you for your order',
      primaryColor: p.primaryColor || '',
      deliveryFeeInsideDhaka: Number(p.deliveryFeeInsideDhaka ?? 0) || 0,
      deliveryFeeOutsideDhaka: Number(p.deliveryFeeOutsideDhaka ?? 0) || 0,
      codLabel: p.codLabel || 'COD',
      currencySymbol: p.currencySymbol || '৳',
      catalogUrl,
    };
  }

  async getUploadedTemplate(
    pageId?: number,
  ): Promise<UploadedMemoTemplate | null> {
    if (!pageId) return null;
    return this.memoAssetService.getTemplate(pageId);
  }

  async uploadTemplate(pageId: number, file: any) {
    return this.memoAssetService.saveUploadedTemplate(pageId, file);
  }

  async updateTemplateMapping(
    pageId: number,
    mapping: Partial<Record<string, TemplateFieldMap>>,
    confirm = false,
  ) {
    return this.memoAssetService.updateTemplateMapping(
      pageId,
      mapping,
      confirm ? 'confirmed' : 'draft',
    );
  }

  async confirmTemplate(pageId: number) {
    return this.memoAssetService.confirmTemplate(pageId);
  }

  async getPreviewData(
    pageId?: number,
    orderId?: number,
  ): Promise<MemoPreviewData> {
    const business = await this.getBusinessInfo(pageId);
    let order: MemoOrderData | undefined;
    if (orderId) {
      order = (await this.getOrdersForMemo([orderId]))[0];
    }

    if (!order) {
      order = {
        id: 1001,
        customerName: 'রহিম উদ্দিন',
        phone: '01700000000',
        address:
          'বাসা ১২, রোড ৪, মিরপুর ১০, ঢাকা। অনেক বড় address হলেও যেন line wrap হয়ে সুন্দরভাবে দেখা যায়।',
        createdAt: new Date().toISOString(),
        items: [
          { productCode: 'DF-001', qty: 1, unitPrice: 650 },
          { productCode: 'DF-099', qty: 2, unitPrice: 180 },
        ],
      };
    }

    const currency = business.currencySymbol || '৳';
    const delivery = this.resolveDeliveryFee(order, business);
    const subtotal = (order.items || []).reduce(
      (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
      0,
    );
    const total = subtotal + delivery;

    return {
      customerName: order.customerName || '-',
      customerPhone: order.phone || '-',
      customerAddress: order.address || '-',
      orderId: `#${order.id || '-'}`,
      date: this.formatDate(order.createdAt),
      businessName: business.companyName || '-',
      businessPhone: business.phone || '-',
      codAmount: `${currency}${total.toFixed(0)}`,
      totalAmount: `${currency}${total.toFixed(0)}`,
      deliveryFee: `${currency}${delivery.toFixed(0)}`,
      items: (order.items || []).length
        ? order.items
            .map(
              (item) =>
                `${item.productCode || '-'} x${Number(item.qty || 0)} = ${currency}${(Number(item.qty || 0) * Number(item.unitPrice || 0)).toFixed(0)}`,
            )
            .join(' | ')
        : 'No item added',
    };
  }

  async generateA4MemoHtml(
    ids: number[],
    pageId?: number,
    layout: MemoLayout = 'memo',
    theme: MemoTheme = 'classic',
    memosPerPage = 3,
  ) {
    const count = memosPerPage === 4 ? 4 : 3;
    const orders = await this.getOrdersForMemo(ids);
    const business = await this.getBusinessInfo(pageId);
    const uploadedTemplate = await this.getUploadedTemplate(pageId);
    return this.memoTemplate.buildA4PageHtml(
      orders,
      business,
      theme,
      layout,
      uploadedTemplate,
      count,
    );
  }

  async generateSampleMemoHtml(
    pageId?: number,
    layout: MemoLayout = 'memo',
    theme: MemoTheme = 'classic',
    memosPerPage = 3,
  ) {
    const count = memosPerPage === 4 ? 4 : 3;
    const sampleOrders: MemoOrderData[] = [
      {
        id: 1001,
        customerName: 'রহিম উদ্দিন',
        phone: '01700-000000',
        address: 'বাসা ১২, রোড ৪, মিরপুর ১০, ঢাকা',
        status: 'CONFIRMED',
        createdAt: new Date().toISOString(),
        items: [
          { productCode: 'DF-001', qty: 1, unitPrice: 650 },
          { productCode: 'DF-002', qty: 2, unitPrice: 180 },
        ],
      },
      {
        id: 1002,
        customerName: 'করিম সাহেব',
        phone: '01800-111222',
        address: 'বাসা ৫, রোড ৭, উত্তরা, ঢাকা',
        status: 'RECEIVED',
        createdAt: new Date().toISOString(),
        items: [{ productCode: 'DF-003', qty: 1, unitPrice: 950 }],
      },
      {
        id: 1003,
        customerName: 'সুমাইয়া আক্তার',
        phone: '01611-333444',
        address: 'বাসা ৩, রোড ৯, বনানী, ঢাকা',
        status: 'DELIVERED',
        createdAt: new Date().toISOString(),
        items: [{ productCode: 'DF-010', qty: 3, unitPrice: 420 }],
      },
      {
        id: 1004,
        customerName: 'মাহবুব হাসান',
        phone: '01911-444555',
        address: 'বাসা ৮, রোড ১২, ধানমন্ডি, ঢাকা',
        status: 'RECEIVED',
        createdAt: new Date().toISOString(),
        items: [{ productCode: 'DF-020', qty: 2, unitPrice: 550 }],
      },
    ];
    const business = await this.getBusinessInfo(pageId);
    const uploadedTemplate = await this.getUploadedTemplate(pageId);
    return this.memoTemplate.buildA4PageHtml(
      sampleOrders.slice(0, count),
      business,
      theme,
      layout,
      uploadedTemplate,
      count,
    );
  }

  async getTemplatePreview(pageId: number, orderId?: number) {
    const business = await this.getBusinessInfo(pageId);
    const uploadedTemplate = await this.getUploadedTemplate(pageId);
    if (!uploadedTemplate) throw new NotFoundException('Template not found');
    const sampleData = await this.getPreviewData(pageId, orderId);
    return {
      template: uploadedTemplate,
      sampleData,
      previewHtml: this.memoTemplate.buildTemplatePreviewHtml(
        uploadedTemplate,
        business,
        sampleData,
      ),
    };
  }

  async getTemplateEditorHtml(pageId: number, orderId?: number) {
    const business = await this.getBusinessInfo(pageId);
    const uploadedTemplate = await this.getUploadedTemplate(pageId);
    if (!uploadedTemplate) throw new NotFoundException('Template not found');
    const sampleData = await this.getPreviewData(pageId, orderId);
    return this.memoTemplate.buildTemplateEditorHtml(
      uploadedTemplate,
      business,
      sampleData,
    );
  }

  private resolveDeliveryFee(order: MemoOrderData, business: BusinessInfo) {
    const address = String(order.address || '').toLowerCase();
    const isDhaka = address.includes('dhaka') || address.includes('ঢাকা');
    return isDhaka
      ? Number(business.deliveryFeeInsideDhaka || 0)
      : Number(business.deliveryFeeOutsideDhaka || 0);
  }

  private formatDate(value?: string) {
    try {
      const d = value ? new Date(value) : new Date();
      if (Number.isNaN(d.getTime())) return '-';
      return d.toLocaleDateString('bn-BD', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '-';
    }
  }
}
