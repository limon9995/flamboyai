import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { ClientDashboardService } from './client-dashboard.service';
import { BotKnowledgeService } from '../bot-knowledge/bot-knowledge.service';
import { AccountingService } from '../accounting/accounting.service';
import { AnalyticsService } from '../accounting/analytics.service';
import { CrmService } from '../crm/crm.service';
import { CourierService } from '../courier/courier.service';
import { CourierAccountingService } from '../courier/courier-accounting.service';
import { FollowUpService } from '../followup/followup.service';
import { BroadcastService } from '../broadcast/broadcast.service';
import { SpamCheckerService } from '../spam-checker/spam-checker.service';
import { GlobalSettingsService } from '../common/global-settings.service';
import { InboxService } from '../inbox/inbox.module';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle({ global: true, auth: true, chat: true })
@Controller('client-dashboard')
@UseGuards(AuthGuard)
export class ClientDashboardController {
  constructor(
    private readonly svc: ClientDashboardService,
    private readonly auth: AuthService,
    private readonly botKnowledge: BotKnowledgeService,
    private readonly accounting: AccountingService,
    private readonly analytics: AnalyticsService,
    private readonly crm: CrmService,
    private readonly courier: CourierService,
    private readonly courierAccounting: CourierAccountingService,
    private readonly followUp: FollowUpService,
    private readonly broadcast: BroadcastService,
    private readonly spamChecker: SpamCheckerService,
    private readonly globalSettings: GlobalSettingsService,
    private readonly inbox: InboxService,
  ) {}

  private pid(req: any, pageId: string): number {
    const n = Number(pageId);
    this.auth.ensurePageAccess(req.user || req.authUser, n);
    return n;
  }

  // ── Global Search ─────────────────────────────────────────────────────────
  @Get(':pageId/search')
  globalSearch(
    @Param('pageId') p: string,
    @Query('q') q: string,
    @Req() r: any,
  ) {
    return this.svc.globalSearch(this.pid(r, p), q || '');
  }

  // ── Core ──────────────────────────────────────────────────────────────────
  @Get(':pageId/summary') summary(@Param('pageId') p: string, @Req() r: any) {
    return this.svc.getSummary(this.pid(r, p));
  }
  @Get(':pageId/sender-count') senderCount(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.svc.getSenderCount(this.pid(r, p));
  }
  @Get(':pageId/modes') modes(@Param('pageId') p: string, @Req() r: any) {
    return this.svc.getModes(this.pid(r, p));
  }
  @Patch(':pageId/modes') updateModes(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.updateModes(this.pid(r, p), b || {});
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  @Get(':pageId/orders') orders(
    @Param('pageId') p: string,
    @Query('status') s: string,
    @Query('source') src: string,
    @Query('paymentStatus') ps: string,
    @Req() r: any,
  ) {
    return this.svc.listOrders(this.pid(r, p), s, src, ps);
  }
  @Post(':pageId/orders/manual') createManualOrder(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.createManualOrder(this.pid(r, p), b || {});
  }
  // NOTE: literal-path GET routes below (delivery-zone, agent-issues,
  // call-queue) MUST be registered before ':orderId' — Express/Nest match
  // routes in registration order, and ':orderId' matches any single segment,
  // so registering it first would silently shadow these and 500 on `Number(o)`
  // being NaN.
  @Get(':pageId/orders/delivery-zone')
  deliveryZone(@Param('pageId') p: string, @Req() r: any) {
    return this.svc.getDeliveryOrders(this.pid(r, p));
  }

  @Get(':pageId/orders/agent-issues')
  getAgentIssues(@Param('pageId') p: string, @Req() r: any) {
    return this.svc.getAgentIssues(this.pid(r, p));
  }

  @Get(':pageId/orders/call-queue')
  getCallQueue(@Param('pageId') p: string, @Req() r: any) {
    return this.svc.getCallQueue(this.pid(r, p));
  }

  @Get(':pageId/orders/:orderId') getOrder(
    @Param('pageId') p: string,
    @Param('orderId', ParseIntPipe) o: number,
    @Req() r: any,
  ) {
    return this.svc.getOrder(this.pid(r, p), o);
  }
  @Patch(':pageId/orders/:orderId') updateOrder(
    @Param('pageId') p: string,
    @Param('orderId', ParseIntPipe) o: number,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.updateOrder(this.pid(r, p), o, b || {});
  }
  @Post(':pageId/orders/:orderId/action') orderAction(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Body('action') action: string,
    @Body('cancelNote') cancelNote: string,
    @Req() r: any,
  ) {
    return this.svc.applyOrderAction(
      this.pid(r, p),
      Number(o),
      String(action || ''),
      cancelNote,
    );
  }
  @Post(':pageId/orders/sync-courier-deliveries')
  syncCourierDeliveries(@Param('pageId') p: string, @Req() r: any) {
    return this.svc.syncCourierDeliveries(this.pid(r, p));
  }

  @Post(':pageId/orders/agent-issues/dismiss')
  dismissAgentIssue(@Param('pageId') p: string, @Body() b: any, @Req() r: any) {
    return this.svc.dismissAgentIssue(this.pid(r, p), b);
  }

  @Post(':pageId/orders/:orderId/toggle-bot')
  toggleBot(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Req() r: any,
  ) {
    return this.svc.toggleBotForCustomer(this.pid(r, p), Number(o));
  }

  @Post(':pageId/orders/toggle-bot-psid')
  toggleBotByPsid(
    @Param('pageId') p: string,
    @Body('psid') psid: string,
    @Body('mute') mute: boolean,
    @Req() r: any,
  ) {
    return this.svc.toggleBotByPsid(this.pid(r, p), psid, mute);
  }

  @Post(':pageId/orders/mark-printed')
  markOrdersPrinted(
    @Param('pageId') p: string,
    @Body('ids') ids: number[],
    @Req() r: any,
  ) {
    return this.svc.markOrdersPrinted(this.pid(r, p), ids || []);
  }

  @Post(':pageId/orders/:orderId/manual-call-log')
  logManualCall(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.logManualCall(this.pid(r, p), Number(o), b || {});
  }

  @Post(':pageId/orders/:orderId/send-call') sendCall(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Req() r: any,
  ) {
    return this.svc.sendCall(this.pid(r, p), Number(o));
  }
  @Post(':pageId/orders/:orderId/resend-call') resendCall(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Req() r: any,
  ) {
    return this.svc.resendCall(this.pid(r, p), Number(o));
  }
  @Post(':pageId/orders/:orderId/confirm-by-call') confirmByCall(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Req() r: any,
  ) {
    return this.svc.confirmByCall(this.pid(r, p), Number(o));
  }
  @Post(':pageId/orders/:orderId/cancel-by-call') cancelByCall(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Req() r: any,
  ) {
    return this.svc.cancelByCall(this.pid(r, p), Number(o));
  }

  // ── V9: Bulk Order Actions ────────────────────────────────────────────────
  @Post(':pageId/orders/bulk-action')
  bulkOrderAction(@Param('pageId') p: string, @Body() b: any, @Req() r: any) {
    return this.svc.bulkOrderAction(
      this.pid(r, p),
      b?.ids || [],
      b?.action || '',
      b?.cancelNote,
    );
  }

  // ── Products ──────────────────────────────────────────────────────────────
  @Get(':pageId/products') listProducts(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.svc.listProducts(this.pid(r, p));
  }
  @Post(':pageId/products') createProduct(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.createProduct(this.pid(r, p), b || {});
  }
  @Patch(':pageId/products/:code') updateProduct(
    @Param('pageId') p: string,
    @Param('code') c: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.updateProduct(this.pid(r, p), c, b || {});
  }
  @Delete(':pageId/products/:code') deleteProduct(
    @Param('pageId') p: string,
    @Param('code') c: string,
    @Req() r: any,
  ) {
    return this.svc.deleteProduct(this.pid(r, p), c);
  }
  @Post(':pageId/products/upload-image')
  @UseInterceptors(FileInterceptor('file'))
  uploadProductImage(
    @Param('pageId') p: string,
    @UploadedFile() file: any,
    @Req() r: any,
  ) {
    return this.svc.uploadProductImage(this.pid(r, p), file);
  }
  @Post(':pageId/products/detect-code')
  detectProductCodeFromImage(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.detectProductCodeFromImage(
      this.pid(r, p),
      String(b?.imageUrl || '').trim(),
    );
  }
  @Post(':pageId/products/analyze-image')
  analyzeProductImage(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.analyzeProductImage(this.pid(r, p), b || {});
  }
  @Post(':pageId/products/batch-analyze')
  batchAnalyzeReferenceImages(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.batchAnalyzeReferenceImages(this.pid(r, p), b || {});
  }
  @Post(':pageId/products/dual-photo-ai')
  setupDualPhotoAI(@Param('pageId') p: string, @Body() b: any, @Req() r: any) {
    const livePhotoUrls: string[] = Array.isArray(b?.livePhotoUrls)
      ? b.livePhotoUrls.map((u: any) => String(u).trim()).filter(Boolean)
      : b?.livePhotoUrl
        ? [String(b.livePhotoUrl).trim()]
        : [];
    return this.svc.setupDualPhotoAI(
      this.pid(r, p),
      String(b?.holdingRefUrl || '').trim(),
      String(b?.wearingRefUrl || '').trim(),
      livePhotoUrls,
    );
  }

  // ── Live Sessions (new Dual Photo system) ────────────────────────────────
  @Get(':pageId/live-sessions')
  getLiveSessions(@Param('pageId') p: string, @Req() r: any) {
    return this.svc.getLiveSessions(this.pid(r, p));
  }

  @Post(':pageId/live-sessions')
  createLiveSession(@Param('pageId') p: string, @Body() b: any, @Req() r: any) {
    return this.svc.createLiveSession(this.pid(r, p), {
      label: b?.label,
      screenshots: Array.isArray(b?.screenshots)
        ? b.screenshots.map(String)
        : [],
      wornProductId: b?.wornProductId ? Number(b.wornProductId) : null,
      heldProductId: b?.heldProductId ? Number(b.heldProductId) : null,
    });
  }

  @Patch(':pageId/live-sessions/:id')
  updateLiveSession(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    const body = b ?? {};
    return this.svc.updateLiveSession(this.pid(r, p), Number(id), {
      label: body.label,
      screenshots: Array.isArray(body.screenshots)
        ? body.screenshots.map(String)
        : undefined,
      wornProductId:
        'wornProductId' in body
          ? body.wornProductId
            ? Number(body.wornProductId)
            : null
          : undefined,
      heldProductId:
        'heldProductId' in body
          ? body.heldProductId
            ? Number(body.heldProductId)
            : null
          : undefined,
      isActive:
        body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    });
  }

  @Delete(':pageId/live-sessions/:id')
  deleteLiveSession(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Req() r: any,
  ) {
    return this.svc.deleteLiveSession(this.pid(r, p), Number(id));
  }

  @Post(':pageId/live-sessions/:id/analyze')
  analyzeLiveSession(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Req() r: any,
  ) {
    return this.svc.analyzeLiveSession(this.pid(r, p), Number(id));
  }

  @Post(':pageId/products/video-guide')
  getProductVideoGuide(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.getProductVideoGuide(this.pid(r, p), b || {});
  }
  @Get(':pageId/vision/summary')
  getVisionSummary(
    @Param('pageId') p: string,
    @Query('days') d: string,
    @Req() r: any,
  ): Promise<any> {
    return this.svc.getVisionSummary(this.pid(r, p), d ? Number(d) : 30);
  }
  @Get(':pageId/vision/review-queue')
  getVisionReviewQueue(
    @Param('pageId') p: string,
    @Req() r: any,
  ): Promise<any[]> {
    return this.svc.getVisionReviewQueue(this.pid(r, p));
  }
  @Patch(':pageId/vision/review-queue/:id')
  updateVisionReviewQueueItem(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Body() b: any,
    @Req() r: any,
  ): Promise<any> {
    return this.svc.updateVisionReviewQueueItem(this.pid(r, p), id, b || {});
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  @Get(':pageId/settings') getSettings(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.svc.getBusinessSettings(this.pid(r, p));
  }
  @Patch(':pageId/settings') updateSettings(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.updateBusinessSettings(this.pid(r, p), b || {});
  }

  // ── Voice ─────────────────────────────────────────────────────────────────
  @Post(':pageId/voice/generate') generateVoice(
    @Param('pageId') p: string,
    @Body('language') lang: string,
    @Req() r: any,
  ) {
    return this.svc.generateVoice(
      this.pid(r, p),
      String(lang || 'BN').toUpperCase() as any,
    );
  }
  @Post(':pageId/voice/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadVoice(
    @Param('pageId') p: string,
    @Body('language') lang: string,
    @UploadedFile() file: any,
    @Req() r: any,
  ) {
    return this.svc.uploadVoice(
      this.pid(r, p),
      String(lang || 'BN').toUpperCase() as any,
      file,
    );
  }
  @Get(':pageId/voice/preview') previewVoice(
    @Param('pageId') p: string,
    @Query('language') lang: string,
    @Req() r: any,
  ) {
    return this.svc.previewVoice(
      this.pid(r, p),
      String(lang || 'BN').toUpperCase() as any,
    );
  }

  // ── Bot Knowledge ─────────────────────────────────────────────────────────
  @Get(':pageId/bot-knowledge') getBotKnowledge(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.botKnowledge.getConfig(this.pid(r, p));
  }
  @Patch(':pageId/bot-knowledge/questions') updateQuestions(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.botKnowledge.updateQuestions(
      this.pid(r, p),
      b?.questions || [],
    );
  }
  @Patch(':pageId/bot-knowledge/system-replies') updateSystemReplies(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.botKnowledge.updateSystemReplies(
      this.pid(r, p),
      b?.systemReplies || {},
    );
  }
  @Patch(':pageId/bot-knowledge/payment-rules') updatePaymentRules(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.botKnowledge.updatePaymentRules(this.pid(r, p), b || {});
  }
  @Patch(':pageId/bot-knowledge/area-rules') updateAreaRules(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.botKnowledge.updateAreaRules(
      this.pid(r, p),
      b?.clientCustomAreas || [],
    );
  }
  @Patch(':pageId/bot-knowledge/pricing-policy') updatePricingPolicy(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.botKnowledge.updatePricingPolicy(this.pid(r, p), b || {});
  }
  @Patch(':pageId/bot-knowledge/pricing-info') updatePricingInfo(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.botKnowledge.updatePricingInfo(this.pid(r, p), b?.pricingInfo ?? '');
  }
  @Post(':pageId/bot-knowledge/import-global/:key') importGlobal(
    @Param('pageId') p: string,
    @Param('key') key: string,
    @Req() r: any,
  ) {
    return this.botKnowledge.importGlobalQuestion(this.pid(r, p), key);
  }
  @Get(':pageId/bot-knowledge/learning-log') learningLog(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.botKnowledge.getLearningLog(this.pid(r, p));
  }
  @Delete(':pageId/bot-knowledge/learning-log/:id') removeLearning(
    @Param('id') id: string,
  ) {
    return this.botKnowledge.removeLearningEntry(id);
  }
  @Post(':pageId/bot-knowledge/learning-log/:id/assign') assignLearning(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.botKnowledge.assignLearningEntry({
      ...b,
      logId: id,
      pageId: this.pid(r, p),
    });
  }

  // ── Templates & Print ─────────────────────────────────────────────────────
  @Get(':pageId/template') getTemplate(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.svc.getTemplate(this.pid(r, p));
  }
  @Post(':pageId/template/upload')
  @UseInterceptors(FileInterceptor('template'))
  uploadTemplate(
    @Param('pageId') p: string,
    @UploadedFile() file: any,
    @Req() r: any,
  ) {
    return this.svc.uploadTemplate(this.pid(r, p), file);
  }
  @Patch(':pageId/template/mapping') updateMapping(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.updateTemplateMapping(
      this.pid(r, p),
      b?.mapping || {},
      b?.confirm || false,
    );
  }
  @Get(':pageId/template/preview') templatePreview(
    @Param('pageId') p: string,
    @Query('orderId') orderId: string,
    @Req() r: any,
  ) {
    return this.svc.getTemplatePreview(
      this.pid(r, p),
      orderId ? Number(orderId) : undefined,
    );
  }
  @Post(':pageId/template/confirm') confirmTemplate(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.svc.confirmTemplate(this.pid(r, p));
  }
  @Post(':pageId/invoice-pdf')
  async invoicePdf(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
    @Res() res: any,
  ) {
    const pdf = await this.svc.getInvoicePdf(
      this.pid(r, p),
      b?.ids || [],
      b?.style,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="memo.pdf"',
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }
  @Post(':pageId/print-html')
  async printHtml(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
    @Res() res: any,
  ) {
    const html = await this.svc.getPrintHtml(
      this.pid(r, p),
      b?.ids || [],
      b?.style,
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
  @Post(':pageId/memo-html')
  async memoHtml(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
    @Res() res: any,
  ) {
    const html = await this.svc.getMemoHtml(
      this.pid(r, p),
      b?.ids || [],
      b?.memosPerPage ? Number(b.memosPerPage) : undefined,
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
  @Post(':pageId/memo-pdf')
  async memoPdf(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
    @Res() res: any,
  ) {
    const pageId = this.pid(r, p);
    const ids: number[] = b?.ids || [];

    await this.svc.chargeMemoDownload(pageId, ids);

    const html = await this.svc.getMemoHtml(
      pageId,
      ids,
      b?.memosPerPage ? Number(b.memosPerPage) : undefined,
    );
    const pdf = await this.svc.htmlToPdf(html);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="memo.pdf"',
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }
  @Get(':pageId/memo-preset') getMemoPreset(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.svc.getMemoPreset(this.pid(r, p));
  }
  @Patch(':pageId/memo-preset') setMemoPreset(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.svc.setMemoPreset(
      this.pid(r, p),
      b?.memoTheme,
      b?.memoLayout,
      b?.memosPerPage ? Number(b.memosPerPage) : undefined,
    );
  }
  @Get(':pageId/memo-preview-html') memoPreviewHtml(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.svc.getMemoPreviewHtml(this.pid(r, p));
  }

  // ── Accounting ────────────────────────────────────────────────────────────
  @Get(':pageId/accounting/overview') accOverview(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.accounting.getOverview(this.pid(r, p));
  }
  @Get(':pageId/accounting/charts/daily-trend') dailyTrend(
    @Param('pageId') p: string,
    @Query('days') d: string,
    @Req() r: any,
  ) {
    return this.accounting.getDailyTrend(this.pid(r, p), d ? Number(d) : 30);
  }
  @Get(':pageId/accounting/charts/expense-breakdown') expBreakdown(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.accounting.getExpenseBreakdown(this.pid(r, p));
  }
  @Get(':pageId/accounting/charts/order-status') orderStatus(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.accounting.getOrderStatusDist(this.pid(r, p));
  }
  @Get(':pageId/accounting/collections') listCols(
    @Param('pageId') p: string,
    @Query('from') f: string,
    @Query('to') t: string,
    @Req() r: any,
  ) {
    return this.accounting.listCollections(this.pid(r, p), f, t);
  }
  @Post(':pageId/accounting/collections') addCol(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.accounting.addCollection(this.pid(r, p), b);
  }
  @Delete(':pageId/accounting/collections/:id') delCol(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Req() r: any,
  ) {
    return this.accounting.deleteCollection(this.pid(r, p), Number(id));
  }
  @Get(':pageId/accounting/expenses') listExp(
    @Param('pageId') p: string,
    @Query('from') f: string,
    @Query('to') t: string,
    @Req() r: any,
  ) {
    return this.accounting.listExpenses(this.pid(r, p), f, t);
  }
  @Post(':pageId/accounting/expenses') addExp(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.accounting.addExpense(this.pid(r, p), b);
  }
  @Delete(':pageId/accounting/expenses/:id') delExp(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Req() r: any,
  ) {
    return this.accounting.deleteExpense(this.pid(r, p), Number(id));
  }
  @Get(':pageId/accounting/returns') listRet(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.accounting.listReturns(this.pid(r, p));
  }
  @Post(':pageId/accounting/returns') addRet(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.accounting.addReturn(this.pid(r, p), b);
  }
  @Patch(':pageId/accounting/returns/:id/partial-items') resolvePartial(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.accounting.resolvePartialItems(
      this.pid(r, p),
      Number(id),
      b?.items || [],
    );
  }
  @Get(':pageId/accounting/refund-queue') getRefundQueue(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.accounting.getRefundQueue(this.pid(r, p));
  }
  @Get(':pageId/accounting/refund-summary') getRefundSummary(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.accounting.getRefundSummary(this.pid(r, p));
  }
  @Patch(':pageId/accounting/refund-queue/:rid/confirm') confirmRefund(
    @Param('pageId') p: string,
    @Param('rid') rid: string,
    @Body('givenAmount') amt: number,
    @Req() r: any,
  ) {
    return this.accounting.confirmRefund(
      this.pid(r, p),
      Number(rid),
      Number(amt) || 0,
    );
  }
  @Patch(':pageId/accounting/refund-queue/:rid/skip') skipRefund(
    @Param('pageId') p: string,
    @Param('rid') rid: string,
    @Req() r: any,
  ) {
    return this.accounting.markRefundNotApplicable(this.pid(r, p), Number(rid));
  }
  @Get(':pageId/accounting/exchanges') listExch(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.accounting.listExchanges(this.pid(r, p));
  }
  @Post(':pageId/accounting/exchanges') addExch(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.accounting.addExchange(this.pid(r, p), b);
  }
  @Get(':pageId/accounting/report/custom') getReportCustom(
    @Param('pageId') p: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() r: any,
  ) {
    const f = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
    const t = to ? new Date(to) : new Date();
    return this.accounting.getReportCustom(this.pid(r, p), f, t);
  }
  @Get(':pageId/accounting/report/:period') getReport(
    @Param('pageId') p: string,
    @Param('period') period: string,
    @Req() r: any,
  ) {
    return this.accounting.getReport(
      this.pid(r, p),
      (['daily', 'weekly', 'monthly'].includes(period)
        ? period
        : 'monthly') as any,
    );
  }
  @Get(':pageId/accounting/export/data') exportData(
    @Param('pageId') p: string,
    @Query('type') type: string,
    @Req() r: any,
  ) {
    return this.accounting.getExportData(
      this.pid(r, p),
      (['collections', 'expenses', 'returns', 'exchanges', 'summary'].includes(
        type,
      )
        ? type
        : 'summary') as any,
    );
  }
  @Get(':pageId/accounting/export/report-html') async exportHtml(
    @Param('pageId') p: string,
    @Query('period') period: string,
    @Req() r: any,
    @Res() res: any,
  ) {
    const html = await this.accounting.buildReportHtml(
      this.pid(r, p),
      (['daily', 'weekly', 'monthly'].includes(period)
        ? period
        : 'monthly') as any,
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  @Get(':pageId/stats/summary') analyticsSummary(
    @Param('pageId') p: string,
    @Query('period') period: string,
    @Req() r: any,
  ) {
    return this.analytics.getAdvancedAnalytics(
      this.pid(r, p),
      (['daily', 'weekly', 'monthly'].includes(period)
        ? period
        : 'monthly') as any,
    );
  }
  @Get(':pageId/stats/overview') motivationDashboard(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.analytics.getMotivationDashboard(this.pid(r, p));
  }
  @Get(':pageId/stats/profit-trend') profitTrend(
    @Param('pageId') p: string,
    @Query('period') period: string,
    @Req() r: any,
  ) {
    return this.analytics.getProfitTrend(
      this.pid(r, p),
      (['daily', 'weekly', 'monthly'].includes(period)
        ? period
        : 'monthly') as any,
    );
  }
  @Get(':pageId/stats/negotiation') negotiation(
    @Param('pageId') p: string,
    @Query('period') period: string,
    @Req() r: any,
  ) {
    const per = (
      ['daily', 'weekly', 'monthly'].includes(period) ? period : 'monthly'
    ) as any;
    const { from, to } = this.accounting.periodRange(per);
    return this.analytics.getNegotiationAnalytics(this.pid(r, p), from, to);
  }
  @Get(':pageId/stats/collection-methods') collMethods(
    @Param('pageId') p: string,
    @Query('period') period: string,
    @Req() r: any,
  ) {
    const per = (
      ['daily', 'weekly', 'monthly'].includes(period) ? period : 'monthly'
    ) as any;
    const { from, to } = this.accounting.periodRange(per);
    return this.analytics.getCollectionMethodBreakdown(
      this.pid(r, p),
      from,
      to,
    );
  }
  @Get(':pageId/stats/top-products') topProds(
    @Param('pageId') p: string,
    @Query('period') period: string,
    @Req() r: any,
  ) {
    const per = (
      ['daily', 'weekly', 'monthly'].includes(period) ? period : 'monthly'
    ) as any;
    const { from, to } = this.accounting.periodRange(per);
    return this.analytics.getProductPerformance(this.pid(r, p), from, to);
  }

  // ── V9: CRM ───────────────────────────────────────────────────────────────
  // ── Inbox ────────────────────────────────────────────────────────────────
  @Get(':pageId/inbox/conversations') inboxConversations(
    @Param('pageId') p: string,
    @Query() q: any,
    @Req() r: any,
  ) {
    return this.inbox.listConversations(this.pid(r, p), {
      platform: q.platform,
      search: q.search,
    });
  }
  @Get(':pageId/inbox/messages') inboxMessages(
    @Param('pageId') p: string,
    @Query() q: any,
    @Req() r: any,
  ) {
    return this.inbox.listMessages(this.pid(r, p), q.platform, q.psid, {
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Get(':pageId/crm/customers') crmList(
    @Param('pageId') p: string,
    @Query() q: any,
    @Req() r: any,
  ) {
    return this.crm.listCustomers(this.pid(r, p), {
      search: q.search,
      tag: q.tag,
      isBlocked: q.blocked === 'true' ? true : undefined,
      orderBy: q.orderBy,
      limit: q.limit ? Number(q.limit) : 50,
      offset: q.offset ? Number(q.offset) : 0,
    });
  }
  @Get(':pageId/crm/customers/stats') crmStats(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.crm.getStats(this.pid(r, p));
  }
  @Get(':pageId/crm/customers/tags') crmTags(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.crm.getAllTags(this.pid(r, p));
  }
  @Get(':pageId/crm/customers/:customerId') crmGet(
    @Param('pageId') p: string,
    @Param('customerId') cid: string,
    @Req() r: any,
  ) {
    return this.crm.getCustomer(this.pid(r, p), Number(cid));
  }
  @Patch(':pageId/crm/customers/:customerId') crmUpdate(
    @Param('pageId') p: string,
    @Param('customerId') cid: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.crm.updateCustomer(this.pid(r, p), Number(cid), b || {});
  }

  // ── V9: Courier ───────────────────────────────────────────────────────────
  @Get(':pageId/courier/shipments') courierList(
    @Param('pageId') p: string,
    @Query('status') s: string,
    @Req() r: any,
  ) {
    return this.courier.listShipments(this.pid(r, p), s);
  }
  @Get(':pageId/courier/settings') courierSettings(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.courier
      .getSettings(this.pid(r, p))
      .then((s) => this.courier.parseSettings(s));
  }
  @Patch(':pageId/courier/settings') saveCourierSettings(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.courier.saveSettings(this.pid(r, p), b || {});
  }
  @Post(':pageId/courier/book') courierBook(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.courier.bookShipment(this.pid(r, p), {
      ...b,
      pageId: this.pid(r, p),
    });
  }
  @Post(':pageId/courier/bulk-book') courierBulkBook(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.courier.bulkBook(
      this.pid(r, p),
      b?.orderIds || [],
      b?.courier || 'manual',
    );
  }
  @Patch(':pageId/courier/manual/:orderId')
  courierManualInfo(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.courier.upsertManualShipment(
      this.pid(r, p),
      Number(o),
      b || {},
    );
  }
  @Post(':pageId/courier/cancel/:orderId') courierCancel(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Req() r: any,
  ) {
    return this.courier.cancelShipment(this.pid(r, p), Number(o));
  }
  @Get(':pageId/courier/track/:orderId') courierTrack(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Req() r: any,
  ) {
    return this.courier.trackShipment(this.pid(r, p), Number(o));
  }

  // ── V9: Follow-up ─────────────────────────────────────────────────────────
  @Get(':pageId/followup') fuList(
    @Param('pageId') p: string,
    @Query('status') s: string,
    @Req() r: any,
  ) {
    return this.followUp.list(this.pid(r, p), s);
  }
  @Post(':pageId/followup') fuCreate(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.followUp.createManual(this.pid(r, p), b || {});
  }
  @Post(':pageId/followup/:id/cancel') fuCancel(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Req() r: any,
  ) {
    return this.followUp.cancel(this.pid(r, p), Number(id));
  }
  @Get(':pageId/followup/settings') fuSettings(
    @Param('pageId') p: string,
    @Req() r: any,
  ) {
    return this.followUp.getSettings(this.pid(r, p));
  }
  @Patch(':pageId/followup/settings') fuSaveSettings(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.followUp.saveSettings(this.pid(r, p), b || {});
  }

  // ── V9: Broadcast ─────────────────────────────────────────────────────────
  @Get(':pageId/broadcast') bcList(@Param('pageId') p: string, @Req() r: any) {
    return this.broadcast.list(this.pid(r, p));
  }
  @Post(':pageId/broadcast') bcCreate(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.broadcast.create(this.pid(r, p), b || {});
  }
  @Post(':pageId/broadcast/:id/send') bcSend(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Req() r: any,
  ) {
    return this.broadcast.send(this.pid(r, p), Number(id));
  }
  @Delete(':pageId/broadcast/:id') bcDelete(
    @Param('pageId') p: string,
    @Param('id') id: string,
    @Req() r: any,
  ) {
    return this.broadcast.delete(this.pid(r, p), Number(id));
  }

  // ── Recurring Subscribers ─────────────────────────────────────────────────
  @Get(':pageId/subscribers')
  getSubscribers(@Param('pageId') p: string, @Req() r: any) {
    return this.broadcast.getSubscribers(this.pid(r, p));
  }

  @Post(':pageId/subscribers/broadcast')
  sendRecurringBroadcast(
    @Param('pageId') p: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.broadcast.sendRecurringBroadcast(this.pid(r, p), b.message);
  }

  // ── V10: Courier tutorial videos ─────────────────────────────────────────
  @Get(':pageId/courier/tutorials')
  courierTutorials(@Param('pageId') p: string, @Req() r: any) {
    this.pid(r, p);
    return this.courier.getTutorials();
  }

  // ── V17: Full tutorials (no pageId — used by ConnectPageScreen before page is linked) ──
  @Get('tutorials')
  tutorialsPublic() {
    return this.courier.getFullTutorials();
  }

  // ── V17: Full tutorials (with pageId — used by SettingsPage / CourierPage) ──
  @Get(':pageId/tutorials')
  tutorialsForPage(@Param('pageId') p: string, @Req() r: any) {
    this.pid(r, p);
    return this.courier.getFullTutorials();
  }

  // ── V10: Courier status update → accounting auto-sync ────────────────────
  @Post(':pageId/courier/status/:orderId')
  updateCourierStatus(
    @Param('pageId') p: string,
    @Param('orderId') o: string,
    @Body() b: any,
    @Req() r: any,
  ) {
    return this.courierAccounting.updateShipmentStatus(
      this.pid(r, p),
      Number(o),
      b?.status || '',
      {
        exchangeOriginalAmount: b?.exchangeOriginalAmount,
        exchangeNewAmount: b?.exchangeNewAmount,
        note: b?.note,
      },
    );
  }

  // ── V10: Courier accounting summary ──────────────────────────────────────
  @Get(':pageId/courier/accounting-summary')
  courierAccountingSummary(@Param('pageId') p: string, @Req() r: any) {
    return this.courierAccounting.getCourierAccountingSummary(this.pid(r, p));
  }

  // ── Wallet ────────────────────────────────────────────────────────────────
  @Get(':pageId/wallet')
  getWallet(@Param('pageId') p: string, @Req() r: any) {
    return this.svc.getWallet(this.pid(r, p));
  }

  @Get(':pageId/wallet/packages')
  getCreditPackages() {
    return this.svc.getCreditPackagesForPage();
  }

  @Get(':pageId/wallet/transactions')
  getWalletTransactions(
    @Param('pageId') p: string,
    @Req() r: any,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getWalletTransactions(
      this.pid(r, p),
      limit ? Number(limit) : 50,
    );
  }

  @Post(':pageId/wallet/recharge-request')
  submitRechargeRequest(
    @Param('pageId') p: string,
    @Req() r: any,
    @Body() b: any,
  ) {
    return this.svc.submitRechargeRequest(this.pid(r, p), {
      packageId: b?.packageId !== undefined ? Number(b.packageId) : undefined,
      amountBdt: b?.amountBdt !== undefined ? Number(b.amountBdt) : undefined,
      method: b?.method || 'bkash',
      transactionId: b?.transactionId || '',
      note: b?.note,
    });
  }

  @Get(':pageId/wallet/recharge-requests')
  getRechargeRequests(@Param('pageId') p: string, @Req() r: any) {
    return this.svc.getRechargeRequests(this.pid(r, p));
  }

  // ── Fraud Checker ─────────────────────────────────────────────────────────
  @Post(':pageId/fraud-check')
  fraudCheck(@Param('pageId') p: string, @Req() r: any, @Body() b: any) {
    const pageId = this.pid(r, p);
    return this.spamChecker.manualCheck(b?.phone ?? '', pageId);
  }

  @Get(':pageId/fraud-check/logs')
  fraudCheckLogs(
    @Param('pageId') p: string,
    @Req() r: any,
    @Query('limit') limit?: string,
  ) {
    return this.spamChecker.getRecentLogs(
      this.pid(r, p),
      limit ? Number(limit) : 20,
    );
  }

  // ── Global AI Settings (Laptop AI toggle) ────────────────────────────────
  @Get('global-ai')
  getGlobalAi() {
    return this.globalSettings.get();
  }

  @Patch('global-ai')
  updateGlobalAi(@Body() b: any) {
    const valid = ['all', 'generate_only', 'none'];
    const mode = valid.includes(b?.localAiMode)
      ? b.localAiMode
      : b?.localAiEnabled === true
        ? 'all'
        : 'none';
    return this.globalSettings.set({ localAiMode: mode });
  }
}
