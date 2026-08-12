import { Injectable, NotFoundException } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../prisma/prisma.service';

export type PrintStyle =
  | 'classic'
  | 'modern'
  | 'minimal'
  | 'colorful'
  | 'fashion'
  | 'luxury'
  | 'thermal';

@Injectable()
export class PrintService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrders(ids: number[], pageId?: number) {
    const where: any = { id: { in: ids } };
    if (pageId) where.pageIdRef = pageId;
    return this.prisma.order.findMany({
      where,
      include: { items: true },
      orderBy: { id: 'desc' },
      take: 20,
    });
  }

  async getPrintPreview(ids: number[], pageId?: number) {
    const orders = await this.getOrders(ids, pageId);
    return {
      count: orders.length,
      generatedAt: new Date().toISOString(),
      orders,
    };
  }

  private esc(v: unknown) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  private money(n: number) {
    return `৳${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  }

  // ── Build HTML for a given print style ────────────────────────────────────
  buildPrintHTML(orders: any[], style: PrintStyle = 'classic'): string {
    let html: string;
    switch (style) {
      case 'modern':
        html = this.buildModern(orders);
        break;
      case 'minimal':
        html = this.buildMinimal(orders);
        break;
      case 'colorful':
        html = this.buildColorful(orders);
        break;
      case 'fashion':
        html = this.buildFashion(orders);
        break;
      case 'luxury':
        html = this.buildLuxury(orders);
        break;
      case 'thermal':
        html = this.buildThermal(orders);
        break;
      default:
        html = this.buildClassic(orders);
    }
    // Inject print-color-adjust so background colors/gradients print correctly
    return html.replace('</style>', `${this.printColorFix}</style>`);
  }

  private printColorFix =
    '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}';

  // ── STYLE 1: Classic (black & white, dense, 3-per-row) ────────────────────
  private buildClassic(orders: any[]): string {
    const cards = orders
      .map((o) => {
        const items =
          (o.items || [])
            .map(
              (i: any) =>
                `<tr><td>${this.esc(i.productCode)}</td><td style="text-align:center">${i.qty}</td><td style="text-align:right">${this.money(i.unitPrice * i.qty)}</td></tr>`,
            )
            .join('') ||
          `<tr><td colspan="3" style="color:#888;text-align:center">—</td></tr>`;
        return `<div class="card"><div class="hd"><span>#${o.id}</span><span>${this.esc(o.customerName || '—')}</span></div><div class="row">📞 ${this.esc(o.phone || '—')}</div><div class="row addr">📍 ${this.esc(o.address || '—')}</div><table>${items}</table></div>`;
      })
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Noto Sans Bengali",Arial,sans-serif;background:#fff;padding:10px;font-size:11px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.card{border:1.5px solid #000;padding:8px;border-radius:4px;break-inside:avoid}
.hd{display:flex;justify-content:space-between;font-weight:700;font-size:12px;border-bottom:1.5px solid #000;padding-bottom:5px;margin-bottom:5px}
.row{margin:3px 0;font-size:11px;word-break:break-word}.addr{font-size:10.5px;color:#333}
table{width:100%;border-collapse:collapse;margin-top:6px;font-size:10.5px}
th,td{border:1px solid #000;padding:3px 5px}th{background:#f5f5f5}
@media print{.no-print{display:none}body{padding:5px}}
</style></head><body>
<div class="no-print" style="text-align:right;padding:6px 0"><button onclick="window.print()" style="padding:8px 16px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer">🖨️ Print</button></div>
<div class="grid">${cards}</div></body></html>`;
  }

  // ── STYLE 2: Modern (gradient header, rounded cards, 3-per-row) ────────────
  private buildModern(orders: any[]): string {
    const cards = orders
      .map((o) => {
        const subtotal = (o.items || []).reduce(
          (s: number, i: any) => s + (i.unitPrice || 0) * (i.qty || 1),
          0,
        );
        const items =
          (o.items || [])
            .map(
              (i: any) =>
                `<tr><td>${this.esc(i.productCode)}</td><td>${i.qty}</td><td>${this.money(i.unitPrice * i.qty)}</td></tr>`,
            )
            .join('') || `<tr><td colspan="3" class="empty">No items</td></tr>`;
        return `<div class="card"><div class="hd"><div class="badge">#${o.id}</div><div class="name">${this.esc(o.customerName || '—')}</div></div><div class="body"><div class="info">📞 ${this.esc(o.phone || '—')}</div><div class="info addr">📍 ${this.esc(o.address || '—')}</div><table class="items">${items}</table><div class="total">Total: <b>${this.money(subtotal)}</b></div></div></div>`;
      })
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Noto Sans Bengali",Arial,sans-serif;background:#f3f4f6;padding:14px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10);break-inside:avoid}
.hd{background:linear-gradient(135deg,#1e40af,#3b82f6);padding:10px 12px;display:flex;align-items:center;gap:8px}
.badge{background:rgba(255,255,255,.22);color:#fff;font-weight:800;font-size:11px;padding:3px 9px;border-radius:999px}
.name{color:#fff;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.body{padding:10px}
.info{font-size:11px;margin-bottom:4px;word-break:break-word}.addr{color:#6b7280;font-size:10.5px}
table.items{width:100%;border-collapse:collapse;margin:8px 0;font-size:10.5px}
table.items td{padding:4px 6px;border-bottom:1px solid #f3f4f6}
.empty{color:#9ca3af;text-align:center;padding:8px}
.total{text-align:right;font-size:12px;color:#1e40af;padding-top:4px}
@media print{.no-print{display:none}body{background:#fff;padding:6px}}
</style></head><body>
<div class="no-print" style="text-align:right;margin-bottom:10px"><button onclick="window.print()" style="padding:9px 18px;background:#1e40af;color:#fff;border:none;border-radius:9px;cursor:pointer;font-weight:700">🖨️ Print</button></div>
<div class="grid">${cards}</div></body></html>`;
  }

  // ── STYLE 3: Minimal (ultra-clean, 4-per-row, no borders) ─────────────────
  private buildMinimal(orders: any[]): string {
    const cards = orders
      .map((o) => {
        const items =
          (o.items || [])
            .map(
              (i: any) =>
                `<div class="item"><span>${this.esc(i.productCode)}</span><span>×${i.qty}</span><span>${this.money(i.unitPrice * i.qty)}</span></div>`,
            )
            .join('') || `<div class="item" style="color:#aaa">—</div>`;
        return `<div class="card"><div class="id">#${o.id}</div><div class="cname">${this.esc(o.customerName || '—')}</div><div class="detail">📞 ${this.esc(o.phone || '—')}</div><div class="detail" style="color:#888">📍 ${this.esc((o.address || '—').slice(0, 55))}</div><div class="items">${items}</div></div>`;
      })
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Noto Sans Bengali",Arial,sans-serif;background:#fff;padding:12px;color:#111}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.card{border-top:3px solid #111;padding:8px 10px;break-inside:avoid;font-size:11px}
.id{font-size:10px;color:#888;letter-spacing:.05em;margin-bottom:2px}
.cname{font-weight:700;font-size:13px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.detail{font-size:10.5px;margin-bottom:2px;color:#555}
.items{margin-top:6px;border-top:1px solid #e5e7eb;padding-top:5px}
.item{display:flex;justify-content:space-between;gap:4px;font-size:10.5px;padding:2px 0}
@media print{.no-print{display:none}body{padding:4px}}
</style></head><body>
<div class="no-print" style="text-align:right;margin-bottom:8px"><button onclick="window.print()" style="padding:7px 14px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer">🖨️ Print</button></div>
<div class="grid">${cards}</div></body></html>`;
  }

  // ── STYLE 4: Colorful (vibrant, per-card accent color, 2-per-row large) ───
  private buildColorful(orders: any[]): string {
    const COLORS = [
      '#7c3aed',
      '#0369a1',
      '#047857',
      '#b45309',
      '#dc2626',
      '#be185d',
      '#0891b2',
      '#65a30d',
    ];
    const cards = orders
      .map((o, idx) => {
        const color = COLORS[idx % COLORS.length];
        const subtotal = (o.items || []).reduce(
          (s: number, i: any) => s + (i.unitPrice || 0) * (i.qty || 1),
          0,
        );
        const items =
          (o.items || [])
            .map(
              (i: any) =>
                `<div class="item" style="border-left:3px solid ${color}"><b>${this.esc(i.productCode)}</b> ×${i.qty} <span style="float:right;font-weight:700">${this.money(i.unitPrice * i.qty)}</span></div>`,
            )
            .join('') ||
          `<div style="color:#aaa;font-size:12px;padding:6px">No items</div>`;
        return `<div class="card"><div class="hd" style="background:${color}"><div class="order-no">Order #${o.id}</div><div class="status-chip">${this.esc(o.status || 'RECEIVED')}</div></div><div class="body"><div class="field"><span class="lbl">Customer</span><span class="val">${this.esc(o.customerName || '—')}</span></div><div class="field"><span class="lbl">Phone</span><span class="val">${this.esc(o.phone || '—')}</span></div><div class="field"><span class="lbl">Address</span><span class="val addr">${this.esc(o.address || '—')}</span></div><div class="items-wrap">${items}</div><div class="total" style="color:${color}">Total: <b>${this.money(subtotal)}</b></div></div></div>`;
      })
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Noto Sans Bengali",Arial,sans-serif;background:#f9fafb;padding:14px;color:#111}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.09);break-inside:avoid}
.hd{padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
.order-no{color:#fff;font-weight:800;font-size:15px}
.status-chip{background:rgba(255,255,255,.22);color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;letter-spacing:.04em}
.body{padding:12px 16px}
.field{display:flex;gap:10px;margin-bottom:6px;align-items:flex-start;font-size:12px}
.lbl{min-width:62px;font-size:10.5px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding-top:1px}
.val{font-weight:600;word-break:break-word}.addr{font-weight:400;color:#374151;font-size:11.5px}
.items-wrap{margin:8px 0;display:flex;flex-direction:column;gap:4px}
.item{background:#f8fafc;padding:6px 10px;border-radius:8px;font-size:12px}
.total{text-align:right;font-size:14px;padding-top:6px;border-top:1px solid #f3f4f6;margin-top:6px}
@media print{.no-print{display:none}body{background:#fff;padding:6px}.card{box-shadow:none;border:1px solid #e5e7eb}}
</style></head><body>
<div class="no-print" style="text-align:right;margin-bottom:12px"><button onclick="window.print()" style="padding:10px 20px;background:#7c3aed;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:14px">🖨️ Print</button></div>
<div class="grid">${cards}</div></body></html>`;
  }

  // ── STYLE 5: Fashion (pink/purple — clothing & fashion) ───────────────────
  private buildFashion(orders: any[]): string {
    const cards = orders
      .map((o) => {
        const subtotal = (o.items || []).reduce(
          (s: number, i: any) => s + (i.unitPrice || 0) * (i.qty || 1),
          0,
        );
        const items =
          (o.items || [])
            .map(
              (i: any) =>
                `<tr><td>${this.esc(i.productCode)}</td><td>${i.qty}</td><td>${this.money(i.unitPrice * i.qty)}</td></tr>`,
            )
            .join('') || `<tr><td colspan="3" class="empty">—</td></tr>`;
        return `<div class="card"><div class="hd"><div class="badge">#${o.id}</div><div class="cname">${this.esc(o.customerName || '—')}</div></div><div class="body"><div class="row">📞 ${this.esc(o.phone || '—')}</div><div class="row addr">📍 ${this.esc(o.address || '—')}</div><table>${items}</table><div class="total">৳ ${this.money(subtotal)}</div></div></div>`;
      })
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Noto Sans Bengali",Arial,sans-serif;background:#fdf2f8;padding:14px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 14px rgba(219,39,119,.12);break-inside:avoid;border:1.5px solid #fbcfe8}
.hd{background:linear-gradient(135deg,#db2777,#9333ea);padding:10px 12px;display:flex;align-items:center;gap:8px}
.badge{background:rgba(255,255,255,.25);color:#fff;font-weight:800;font-size:11px;padding:3px 9px;border-radius:999px}
.cname{color:#fff;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.body{padding:10px}.row{font-size:11px;margin-bottom:4px;word-break:break-word}.addr{color:#6b7280;font-size:10.5px}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:10.5px}
table td{padding:3px 6px;border-bottom:1px solid #fce7f3}
.empty{color:#9ca3af;text-align:center;padding:6px}.total{text-align:right;font-size:13px;font-weight:800;color:#db2777;padding-top:4px}
@media print{.no-print{display:none}body{background:#fff;padding:6px}}
</style></head><body>
<div class="no-print" style="text-align:right;margin-bottom:10px"><button onclick="window.print()" style="padding:9px 18px;background:linear-gradient(135deg,#db2777,#9333ea);color:#fff;border:none;border-radius:9px;cursor:pointer;font-weight:700">🖨️ Print</button></div>
<div class="grid">${cards}</div></body></html>`;
  }

  // ── STYLE 6: Luxury (dark + gold — premium products) ─────────────────────
  private buildLuxury(orders: any[]): string {
    const cards = orders
      .map((o) => {
        const subtotal = (o.items || []).reduce(
          (s: number, i: any) => s + (i.unitPrice || 0) * (i.qty || 1),
          0,
        );
        const items =
          (o.items || [])
            .map(
              (i: any) =>
                `<div class="item"><span>${this.esc(i.productCode)}</span><span>×${i.qty}</span><span class="price">${this.money(i.unitPrice * i.qty)}</span></div>`,
            )
            .join('') || `<div class="item" style="color:#6b7280">—</div>`;
        return `<div class="card"><div class="hd"><span class="order-no">No. ${o.id}</span><span class="divider">|</span><span class="cname">${this.esc(o.customerName || '—')}</span></div><div class="body"><div class="row"><span class="lbl">Phone</span> ${this.esc(o.phone || '—')}</div><div class="row"><span class="lbl">Address</span> ${this.esc(o.address || '—')}</div><div class="items">${items}</div><div class="total"><span class="lbl">Total</span> ${this.money(subtotal)}</div></div></div>`;
      })
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Noto Sans Bengali",Georgia,serif;background:#1a1a1a;padding:14px;color:#e5d9b6}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.card{background:#111;border-radius:0;border:1px solid #c9a84c;break-inside:avoid}
.hd{background:#c9a84c;padding:8px 14px;display:flex;align-items:center;gap:8px;color:#111}
.order-no{font-weight:900;font-size:13px;letter-spacing:.06em}.divider{opacity:.5}.cname{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.body{padding:12px}.row{font-size:11px;margin-bottom:5px;word-break:break-word}
.lbl{color:#c9a84c;font-size:10px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-right:6px}
.items{margin:8px 0;border-top:1px solid #333;padding-top:8px;display:flex;flex-direction:column;gap:4px}
.item{display:flex;justify-content:space-between;gap:8px;font-size:11px}.price{color:#c9a84c;font-weight:700}
.total{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:800;color:#c9a84c;border-top:1px solid #333;padding-top:8px;margin-top:4px}
@media print{.no-print{display:none}body{background:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="no-print" style="text-align:right;margin-bottom:12px"><button onclick="window.print()" style="padding:9px 20px;background:#c9a84c;color:#111;border:none;border-radius:4px;cursor:pointer;font-weight:800;letter-spacing:.05em">✦ PRINT</button></div>
<div class="grid">${cards}</div></body></html>`;
  }

  // ── STYLE 7: Thermal (courier receipt — POS/thermal printer) ──────────────
  private buildThermal(orders: any[]): string {
    const cards = orders
      .map((o) => {
        const subtotal = (o.items || []).reduce(
          (s: number, i: any) => s + (i.unitPrice || 0) * (i.qty || 1),
          0,
        );
        const items =
          (o.items || [])
            .map(
              (i: any) =>
                `<div class="item"><span>${this.esc(i.productCode)} x${i.qty}</span><span>${this.money(i.unitPrice * i.qty)}</span></div>`,
            )
            .join('') || `<div class="item"><span>—</span></div>`;
        return `<div class="receipt"><div class="top">FlamboyAI ORDER</div><div class="sep">================================</div><div class="row"><b>Order:</b> #${o.id}</div><div class="row"><b>Name:</b> ${this.esc(o.customerName || '—')}</div><div class="row"><b>Phone:</b> ${this.esc(o.phone || '—')}</div><div class="row addr"><b>Addr:</b> ${this.esc(o.address || '—')}</div><div class="sep">--------------------------------</div><div class="items">${items}</div><div class="sep">================================</div><div class="total">TOTAL: ${this.money(subtotal)}</div><div class="sep">================================</div><div class="footer">Thank you!</div></div>`;
      })
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Courier New",Courier,monospace;background:#f5f5f5;padding:10px;font-size:12px}
.grid{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-start}
.receipt{background:#fff;border:1px dashed #999;padding:12px 14px;width:240px;break-inside:avoid;font-size:11px;line-height:1.6}
.top{text-align:center;font-weight:900;font-size:13px;letter-spacing:.1em;margin-bottom:4px}
.sep{color:#999;margin:4px 0;white-space:pre;overflow:hidden;font-size:10px}
.row{margin:2px 0;word-break:break-all}.addr{font-size:10.5px}
.items{margin:4px 0;display:flex;flex-direction:column;gap:2px}
.item{display:flex;justify-content:space-between;gap:6px;font-size:10.5px}
.total{font-weight:900;font-size:14px;margin:4px 0}
.footer{text-align:center;font-size:10px;color:#777;margin-top:4px}
@media print{.no-print{display:none}body{background:#fff;padding:4px}.receipt{border-color:#ccc}}
</style></head><body>
<div class="no-print" style="text-align:right;margin-bottom:8px"><button onclick="window.print()" style="padding:7px 14px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:monospace">🖨️ Print</button></div>
<div class="grid">${cards}</div></body></html>`;
  }

  async generateInvoicePDF(
    ids: number[],
    style: PrintStyle = 'classic',
    pageId?: number,
  ) {
    const orders = await this.getOrders(ids, pageId);
    if (!orders.length) throw new NotFoundException('No orders found');
    return this.generatePdfFromHtml(this.buildPrintHTML(orders, style));
  }

  async generatePdfFromHtml(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    await browser.close();
    return Buffer.from(pdf);
  }
}
