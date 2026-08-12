import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthGuard } from '../auth/auth.guard';
import { TelegramNotificationService } from './telegram-notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { MessengerService } from '../messenger/messenger.service';
import { TelegramService as AdminTelegramService } from '../common/telegram.service';
// Type import + runtime token for ModuleRef lookup. Not imported as a Nest
// module (CourierModule → OrdersModule → TelegramModule would be circular), so
// we resolve CourierService lazily via ModuleRef instead.
import { CourierService } from '../courier/courier.service';
// Same circular-dependency situation as CourierService (OrdersModule imports
// TelegramModule) — resolved lazily via ModuleRef.
import { OrdersService } from '../orders/orders.service';
// AdminModule imports TelegramModule too — also resolved via ModuleRef.
import { AdminService } from '../admin/admin.service';

/** Escape HTML for Telegram parse_mode: 'HTML' messages. */
function tgEsc(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Persistent reply keyboards (the button menu pinned under the chat input) ──
// A pressed button arrives back as a plain text message equal to its label, so
// each label maps to the slash-command it triggers. Keyboard layout and the
// label→command map are derived from the same source to guarantee exact match.

const ADMIN_BUTTONS: Array<Array<{ label: string; cmd: string }>> = [
  [
    { label: '📊 Overview', cmd: '/overview' },
    { label: '👥 Users', cmd: '/users' },
  ],
  [
    { label: '📄 Pages', cmd: '/pages' },
    { label: '💳 Recharges', cmd: '/recharges' },
  ],
  [
    { label: '🔑 Page Requests', cmd: '/pagerequests' },
    { label: '📈 Profit', cmd: '/profit' },
  ],
  [
    { label: '💰 Balance +/-', cmd: '/balance' },
    { label: '❓ Help', cmd: '/help' },
  ],
];
const ADMIN_KEYBOARD: string[][] = ADMIN_BUTTONS.map((r) =>
  r.map((b) => b.label),
);
const ADMIN_BUTTON_COMMANDS: Record<string, string> = Object.fromEntries(
  ADMIN_BUTTONS.flat().map((b) => [b.label, b.cmd]),
);

const MERCHANT_BUTTONS: Array<Array<{ label: string; cmd: string }>> = [
  [
    { label: '🛒 আজকের অর্ডার', cmd: '/today' },
    { label: '⏳ পেন্ডিং অর্ডার', cmd: '/pending' },
  ],
  [
    { label: '💳 পেমেন্ট চেক', cmd: '/payments' },
    { label: '📊 রিপোর্ট', cmd: '/report' },
  ],
  [
    { label: '💰 ব্যালেন্স', cmd: '/balance' },
    { label: '🛍 প্রোডাক্ট', cmd: '/products' },
  ],
  [{ label: '❓ সাহায্য', cmd: '/help' }],
];
const MERCHANT_KEYBOARD: string[][] = MERCHANT_BUTTONS.map((r) =>
  r.map((b) => b.label),
);
const MERCHANT_BUTTON_COMMANDS: Record<string, string> = Object.fromEntries(
  MERCHANT_BUTTONS.flat().map((b) => [b.label, b.cmd]),
);

/** Format a number (BDT or credit) — whole numbers stay whole, fractions keep 2 digits. */
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly telegram: TelegramNotificationService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly messenger: MessengerService,
    private readonly adminTelegram: AdminTelegramService,
    private readonly moduleRef: ModuleRef,
  ) {}

  @Post('test')
  @UseGuards(AuthGuard)
  async test(@Body() body: { token: string; chatId: string }) {
    if (!body?.token || !body?.chatId) {
      return { ok: false, error: 'token and chatId are required' };
    }
    return this.telegram.sendTest(body.token.trim(), body.chatId.trim());
  }

  @Post('fetch-chat-id')
  @UseGuards(AuthGuard)
  async fetchChatId(@Body() body: { token: string }) {
    if (!body?.token) {
      return { ok: false, error: 'token is required' };
    }
    const token = body.token.trim();
    try {
      // Telegram's getUpdates returns nothing (silently, ok:true + empty
      // result) while a webhook is registered for this bot — and this app
      // registers one on every successful save (for the inline Confirm/
      // Courier buttons). A previous save attempt with this same token can
      // leave a webhook attached, permanently blocking auto-fetch even
      // though the customer's messages really did arrive. deleteWebhook is
      // a harmless no-op if none was set, so always clear it first.
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
        signal: AbortSignal.timeout(8_000),
      }).catch(() => {});

      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?limit=10`,
        { signal: AbortSignal.timeout(8_000) },
      );
      const data = await res.json();
      if (!data.ok) {
        return {
          ok: false,
          error: data.description || 'Invalid token or Telegram API error',
        };
      }
      const results = (data.result ?? []) as any[];
      // Pick the MOST RECENT message, not the first — Telegram returns
      // updates oldest-first, and stale test messages (e.g. the merchant
      // trying the bot themselves before handing it to their client) stay
      // queued for a while. Always fetching the last one ensures whoever
      // messaged most recently (the intended recipient) wins.
      const matching = results.filter(
        (u: any) => u.message?.chat?.id || u.channel_post?.chat?.id,
      );
      const update = matching[matching.length - 1];
      const chatId =
        update?.message?.chat?.id ?? update?.channel_post?.chat?.id ?? null;
      if (!chatId) {
        return {
          ok: false,
          error: 'No messages found. Please send a message to your bot first.',
        };
      }
      // Acknowledge all fetched updates so old/stale messages don't linger
      // and get picked up again by a future auto-fetch for this same bot.
      const lastUpdateId = results[results.length - 1]?.update_id;
      if (lastUpdateId !== undefined) {
        fetch(
          `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}`,
          { signal: AbortSignal.timeout(8_000) },
        ).catch(() => {});
      }
      return { ok: true, chatId: String(chatId) };
    } catch {
      return { ok: false, error: 'Failed to reach Telegram API' };
    }
  }

  /**
   * Auto-setup: set Telegram webhook after saving bot token.
   * Called from client-dashboard settings save.
   */
  @Post('setup-webhook')
  @UseGuards(AuthGuard)
  async setupWebhook(
    @Body() body: { token: string; pageId: number; baseUrl?: string },
  ) {
    if (!body?.token || !body?.pageId) {
      return { ok: false, error: 'token and pageId required' };
    }
    const encryptedToken = this.encryption.encrypt(body.token.trim());
    const baseUrl = (body.baseUrl ?? 'https://api.flamboyai.com').replace(
      /\/$/,
      '',
    );
    const webhookUrl = `${baseUrl}/telegram/callback/${encodeURIComponent(encryptedToken)}`;
    return this.telegram.setWebhook(body.token.trim(), webhookUrl);
  }

  /**
   * Registers the webhook for the single global admin bot (the one that
   * sends PageRequest/AgentRequest notifications), so its Approve/Reject
   * inline buttons start working. Admin-only, run once after configuring
   * the admin bot token in Admin > API Keys (or again if it's ever changed).
   */
  @Post('setup-admin-webhook')
  @UseGuards(AuthGuard)
  async setupAdminWebhook(@Body() body: { baseUrl?: string }) {
    const token = this.adminTelegram.getAdminBotToken();
    if (!token)
      return { ok: false, error: 'No admin telegramBotToken configured' };
    const baseUrl = (body?.baseUrl ?? 'https://api.flamboyai.com').replace(
      /\/$/,
      '',
    );
    const webhookUrl = `${baseUrl}/telegram/admin-callback/${encodeURIComponent(token)}`;
    return this.adminTelegram.setAdminWebhook(webhookUrl);
  }

  /**
   * Telegram sends callback_query events here when inline buttons are pressed.
   * URL: POST /telegram/callback/:encryptedToken
   * No auth guard — Telegram calls this directly.
   */
  @Post('callback/:encryptedToken')
  async handleCallback(
    @Param('encryptedToken') encryptedToken: string,
    @Body() update: any,
  ) {
    // ── Merchant text commands (permanent keyboard buttons arrive as text) ──
    // The webhook secret in the URL proves the sender is Telegram; the chat id
    // pin proves the human is the page's merchant (anyone can message a bot).
    const msg = update?.message;
    if (msg?.text) {
      const page = await this.prisma.page.findFirst({
        where: { telegramBotToken: encryptedToken },
        select: {
          id: true,
          pageName: true,
          telegramChatId: true,
          telegramBotToken: true,
        },
      });
      if (
        page?.telegramBotToken &&
        page.telegramChatId &&
        String(msg.chat?.id) === String(page.telegramChatId)
      ) {
        const token = this.encryption.decrypt(page.telegramBotToken);
        await this.handleMerchantCommand(
          page.id,
          page.pageName,
          token,
          page.telegramChatId,
          String(msg.text).trim(),
        );
      }
      return { ok: true };
    }

    // Handle callback_query (button press)
    const cbq = update?.callback_query;
    if (!cbq) return { ok: true };

    const callbackQueryId = cbq.id as string;
    const data = cbq.data as string | undefined;
    if (!data) return { ok: true };

    // Find page by encrypted token
    const page = await this.prisma.page.findFirst({
      where: { telegramBotToken: encryptedToken },
      select: { id: true, telegramChatId: true, telegramBotToken: true },
    });
    if (!page || !page.telegramBotToken) return { ok: true };

    const token = this.encryption.decrypt(page.telegramBotToken);

    // Parse action: confirm_{orderId} | fraud_{orderId} | payok_{orderId} | payfail_{orderId} | advrefund_confirm_{returnId} | advrefund_skip_{returnId}
    const parts = data.split('_');
    const action = parts[0];
    const orderId = parseInt(parts[parts.length - 1] ?? '0', 10);

    if (action === 'advrefund' && orderId) {
      const subAction = parts[1]; // 'confirm' or 'skip'
      await this.handleAdvanceRefund(
        page.id,
        orderId,
        subAction,
        token,
        callbackQueryId,
        page.telegramChatId ?? '',
      );
    } else if (action === 'confirm' && orderId) {
      await this.handleConfirm(
        page.id,
        orderId,
        token,
        callbackQueryId,
        page.telegramChatId ?? '',
      );
    } else if (action === 'courier' && orderId) {
      await this.handleCourierBook(
        page.id,
        orderId,
        token,
        callbackQueryId,
        page.telegramChatId ?? '',
      );
    } else if ((action === 'payok' || action === 'payfail') && orderId) {
      await this.handlePaymentVerify(
        page.id,
        orderId,
        action === 'payok',
        token,
        callbackQueryId,
        page.telegramChatId ?? '',
      );
    } else if (action === 'fraud' && orderId) {
      await this.handleFraud(
        page.id,
        orderId,
        token,
        callbackQueryId,
        page.telegramChatId ?? '',
      );
    } else {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '❓ Unknown action',
      );
    }

    return { ok: true };
  }

  /**
   * Callback endpoint for the single global ADMIN bot (PageRequest/AgentRequest
   * Approve/Reject buttons) — not tied to any Page. Secured by requiring the
   * URL's :token segment to match the currently configured admin bot token
   * (same secret-in-URL pattern as the per-page /telegram/callback/:encryptedToken
   * route above), since Telegram has nowhere else to authenticate this webhook.
   * No auth guard — Telegram calls this directly.
   */
  @Post('admin-callback/:token')
  async handleAdminCallback(
    @Param('token') token: string,
    @Body() update: any,
  ) {
    const expected = this.adminTelegram.getAdminBotToken();
    if (!expected || token !== expected) return { ok: true };

    // ── Admin slash-commands (plain text messages to the admin bot) ────────
    // The webhook secret in the URL proves the sender is Telegram; the chat id
    // pin proves the human is the platform owner (anyone can message a bot).
    const msg = update?.message;
    if (msg?.text) {
      const adminChatId = this.adminTelegram.getAdminChatId();
      if (adminChatId && String(msg.chat?.id) === String(adminChatId)) {
        await this.handleAdminCommand(String(msg.text).trim());
      }
      return { ok: true };
    }

    const cbq = update?.callback_query;
    if (!cbq) return { ok: true };
    const callbackQueryId = cbq.id as string;
    const data = cbq.data as string | undefined;
    if (!data) return { ok: true };

    // Format: pagereq_reject_<id>
    // (approval no longer happens via callback_data — the Telegram message's
    // "Login with Facebook & Approve" button is a url button that goes
    // straight to /facebook/callback, bypassing this handler entirely.)
    const parts = data.split('_');
    const domain = parts[0];
    const action = parts[1];
    const id = parseInt(parts[parts.length - 1] ?? '0', 10);

    if (domain === 'pagereq' && id && action === 'reject') {
      await this.handleAdminPageRequestAction(id, action, callbackQueryId);
    } else if (
      domain === 'recharge' &&
      id &&
      (action === 'approve' || action === 'reject')
    ) {
      await this.handleRechargeAction(id, action, callbackQueryId);
    } else if (domain === 'adm' && action) {
      await this.handleAdminInlineAction(action, id, callbackQueryId);
    } else {
      await this.adminTelegram.answerCallback(
        callbackQueryId,
        '❓ Unknown action',
      );
    }

    return { ok: true };
  }

  // ── Admin Telegram command panel ─────────────────────────────────────────

  private adminSvc(): AdminService {
    return this.moduleRef.get(AdminService, { strict: false });
  }

  private async handleAdminCommand(text: string): Promise<void> {
    // Permanent-keyboard buttons come back as their label text — map to command.
    const mapped = ADMIN_BUTTON_COMMANDS[text] ?? text;
    const [cmdRaw, ...args] = mapped.split(/\s+/);
    const cmd = cmdRaw.toLowerCase().replace(/@.*$/, ''); // strip @botname suffix
    try {
      switch (cmd) {
        case '/start':
        case '/help':
          return await this.sendAdminHelp();
        case '/overview':
          return await this.cmdOverview();
        case '/users':
          return await this.cmdUsers(0);
        case '/pages':
          return await this.cmdPages(args.join(' '));
        case '/recharges':
          return await this.cmdRecharges();
        case '/pagerequests':
          return await this.cmdPageRequests();
        case '/suspend':
          return await this.cmdSetPageStatus(
            parseInt(args[0], 10),
            'SUSPENDED',
          );
        case '/activate':
          return await this.cmdSetPageStatus(parseInt(args[0], 10), 'ACTIVE');
        case '/ban':
          return await this.cmdSetUserActive(args[0], false);
        case '/unban':
          return await this.cmdSetUserActive(args[0], true);
        case '/profit':
          return await this.cmdProfit(args[0]);
        case '/testpage':
          return await this.cmdToggleTestPage(parseInt(args[0], 10));
        case '/balance':
          return await this.cmdBalanceHelp();
        case '/addbalance':
          return await this.cmdAdjustBalance(args, 1);
        case '/cutbalance':
          return await this.cmdAdjustBalance(args, -1);
        default:
          await this.adminTelegram.sendMessageWithKeyboard(
            '❓ অজানা command। নিচের বাটন ব্যবহার করুন বা /help পাঠান।',
            ADMIN_KEYBOARD,
          );
      }
    } catch (err: any) {
      await this.adminTelegram.sendMessage(
        `❌ Error: ${tgEsc(err?.message ?? err)}`,
      );
    }
  }

  private async sendAdminHelp(): Promise<void> {
    await this.adminTelegram.sendMessageWithKeyboard(
      [
        '🛠 <b>FlamboyAI Admin Panel</b>',
        '',
        'নিচের permanent বাটন থেকে এক চাপে সব কাজ করা যায়। Command-ও চলে:',
        '',
        '/overview — সিস্টেম overview (pages, orders, users)',
        '/users — সব client-এর list',
        '/pages <code>[search]</code> — page list (balance/status) + suspend button',
        '/suspend <code>&lt;pageId&gt;</code> — page suspend (bot বন্ধ হবে)',
        '/activate <code>&lt;pageId&gt;</code> — page আবার চালু',
        '/ban <code>&lt;username&gt;</code> — user login বন্ধ',
        '/unban <code>&lt;username&gt;</code> — user login চালু',
        '/recharges — pending recharge request (approve/reject button সহ)',
        '/pagerequests — pending page connect request (approve/reject সহ)',
        '/addbalance <code>&lt;pageId&gt; &lt;amount&gt; [note]</code> — balance-এ credit যোগ',
        '/cutbalance <code>&lt;pageId&gt; &lt;amount&gt; [note]</code> — balance থেকে credit কাটা',
        '/profit <code>[YYYY-MM]</code> — revenue, real AI cost ও profit (test page বাদে)',
        '/testpage <code>&lt;pageId&gt;</code> — নিজের test page মার্ক/আনমার্ক (profit হিসাবের বাইরে থাকবে)',
      ].join('\n'),
      ADMIN_KEYBOARD,
    );
  }

  private async cmdBalanceHelp(): Promise<void> {
    await this.adminTelegram.sendMessage(
      [
        '💰 <b>Balance Add / Cut</b>',
        '',
        'যোগ করতে: <code>/addbalance 5 500 bonus</code>',
        'কাটতে: <code>/cutbalance 5 200 correction</code>',
        '(প্রথমে pageId, তারপর amount, শেষে optional note)',
        '',
        'Page ID পেতে /pages পাঠান।',
      ].join('\n'),
    );
  }

  private async cmdAdjustBalance(args: string[], sign: 1 | -1): Promise<void> {
    const pageId = parseInt(args[0], 10);
    const amount = Math.abs(parseFloat(args[1]));
    if (!pageId || Number.isNaN(pageId) || !amount || Number.isNaN(amount)) {
      await this.adminTelegram.sendMessage(
        `⚠️ ফরম্যাট: <code>/${sign > 0 ? 'addbalance' : 'cutbalance'} &lt;pageId&gt; &lt;amount&gt; [note]</code>\nPage ID পেতে /pages পাঠান।`,
      );
      return;
    }
    const note = args.slice(2).join(' ');
    await this.adminSvc().adjustPageWallet(
      pageId,
      sign * amount,
      note ? `${note} (via Telegram)` : 'Manual adjustment via Telegram',
    );
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { pageName: true, creditBalance: true },
    });
    const newBalance = fmtNum(
      Math.round((page?.creditBalance ?? 0) * 100) / 100,
    );
    await this.adminTelegram.sendMessage(
      sign > 0
        ? `✅ Page #${pageId} <b>${tgEsc(page?.pageName ?? '')}</b>-এ ${fmtNum(amount)} credit যোগ হলো।\n💰 নতুন balance: ${newBalance} credit`
        : `✅ Page #${pageId} <b>${tgEsc(page?.pageName ?? '')}</b> থেকে ${fmtNum(amount)} credit কাটা হলো।\n💰 নতুন balance: ${newBalance} credit`,
    );
  }

  private async cmdToggleTestPage(pageId: number): Promise<void> {
    if (!pageId || Number.isNaN(pageId)) {
      await this.adminTelegram.sendMessage(
        '⚠️ Page ID দিন — যেমন: <code>/testpage 5</code>\nPage ID পেতে /pages পাঠান।',
      );
      return;
    }
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { pageName: true, isTestPage: true },
    });
    if (!page) {
      await this.adminTelegram.sendMessage(`❌ Page #${pageId} পাওয়া যায়নি।`);
      return;
    }
    const next = !page.isTestPage;
    await this.adminSvc().setPageTestFlag(pageId, next);
    await this.adminTelegram.sendMessage(
      next
        ? `🧪 Page #${pageId} <b>${tgEsc(page.pageName)}</b> এখন <b>test page</b> — profit হিসাবের বাইরে থাকবে।`
        : `✅ Page #${pageId} <b>${tgEsc(page.pageName)}</b> আর test page নয় — profit হিসাবে ধরা হবে।`,
    );
  }

  private async cmdPageRequests(): Promise<void> {
    const pending = await this.adminSvc().getPageRequests('pending');
    if (!pending.length) {
      await this.adminTelegram.sendMessage('✅ কোনো pending page request নেই।');
      return;
    }
    for (const r of pending.slice(0, 10)) {
      const approveUrl = this.adminSvc().getPageRequestApproveUrl(r.id).url;
      await this.adminTelegram.sendMessageWithButtons(
        [
          `🔑 <b>Page Request #${r.id}</b>`,
          `👤 ${tgEsc(r.user?.name || r.user?.username || '?')} (${tgEsc(r.user?.email ?? '')})`,
          `🔗 ${tgEsc(r.pageUrl)}`,
          r.fbProfile ? `👤 FB Profile: ${tgEsc(r.fbProfile)}` : '',
          r.note ? `📝 ${tgEsc(r.note)}` : '',
          `🕐 ${new Date(r.createdAt).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}`,
        ]
          .filter(Boolean)
          .join('\n'),
        [
          [
            { text: '🔗 Login with Facebook & Approve', url: approveUrl },
            { text: '❌ Reject', callback_data: `pagereq_reject_${r.id}` },
          ],
        ],
      );
    }
    if (pending.length > 10) {
      await this.adminTelegram.sendMessage(
        `…আরো ${pending.length - 10}টা pending আছে।`,
      );
    }
  }

  private async cmdOverview(): Promise<void> {
    const o = await this.adminSvc().overview();
    await this.adminTelegram.sendMessage(
      [
        '📊 <b>System Overview</b>',
        `📄 Pages: ${o.totalPages} (bot ON: ${o.pagesWithBot})`,
        `👥 Users: ${o.totalUsers} (active: ${o.activeUsers})`,
        `🛍 Products: ${o.totalProducts}`,
        `🛒 Orders: ${o.totalOrders} (আজ: ${o.todayOrders})`,
        `⏳ Pending: ${o.pendingOrders} | ✅ Confirmed: ${o.confirmedOrders}`,
        `🔑 Pending page requests: ${o.pendingPageRequests}`,
      ].join('\n'),
    );
  }

  private async cmdUsers(offset: number): Promise<void> {
    const all = await this.adminSvc().clients();
    const PAGE = 10;
    const slice = all.slice(offset, offset + PAGE);
    if (!slice.length) {
      await this.adminTelegram.sendMessage('কোনো user নেই।');
      return;
    }
    const lines = slice.map((u: any, i: number) => {
      const date = new Date(u.createdAt).toISOString().slice(0, 10);
      return `${offset + i + 1}. ${u.isActive ? '✅' : '🚫'} <b>${tgEsc(u.name || u.username)}</b> (${tgEsc(u.username)})\n   📄 ${u.pageCount} page | 📅 ${date}`;
    });
    const header = `👥 <b>Users ${offset + 1}-${offset + slice.length}</b> / ${all.length}`;
    const hasMore = offset + PAGE < all.length;
    if (hasMore) {
      await this.adminTelegram.sendMessageWithButtons(
        `${header}\n\n${lines.join('\n')}`,
        [[{ text: '▶️ Next 10', callback_data: `adm_users_${offset + PAGE}` }]],
      );
    } else {
      await this.adminTelegram.sendMessage(`${header}\n\n${lines.join('\n')}`);
    }
  }

  private async cmdPages(query: string): Promise<void> {
    const all = await this.adminSvc().getAllPagesWallet();
    const q = (query || '').toLowerCase();
    const filtered = q
      ? all.filter(
          (p: any) =>
            String(p.pageName || '')
              .toLowerCase()
              .includes(q) ||
            String(p.owner?.username || '')
              .toLowerCase()
              .includes(q) ||
            String(p.id) === q,
        )
      : all;
    const slice = filtered.slice(0, 10);
    if (!slice.length) {
      await this.adminTelegram.sendMessage('কোনো page পাওয়া যায়নি।');
      return;
    }
    const lines = slice.map((p: any) => {
      const st = p.subscriptionStatus === 'ACTIVE' ? '✅' : '🚫';
      const test = p.isTestPage ? ' 🧪test' : '';
      return `${st} <b>#${p.id} ${tgEsc(p.pageName)}</b>${test}\n   👤 ${tgEsc(p.owner?.username ?? '?')} | 💰 ${Math.round(p.creditBalance)} credit | ${p.subscriptionStatus}`;
    });
    const buttons = slice.map((p: any) =>
      p.subscriptionStatus === 'ACTIVE'
        ? [
            {
              text: `🚫 Suspend #${p.id} ${String(p.pageName).slice(0, 20)}`,
              callback_data: `adm_suspend_${p.id}`,
            },
          ]
        : [
            {
              text: `✅ Activate #${p.id} ${String(p.pageName).slice(0, 20)}`,
              callback_data: `adm_activate_${p.id}`,
            },
          ],
    );
    await this.adminTelegram.sendMessageWithButtons(
      `📄 <b>Pages${q ? ` — "${tgEsc(query)}"` : ''}</b> (${slice.length}/${filtered.length})\n\n${lines.join('\n')}`,
      buttons,
    );
  }

  private async cmdRecharges(): Promise<void> {
    const pending = await this.adminSvc().getAllRechargeRequests('pending');
    if (!pending.length) {
      await this.adminTelegram.sendMessage(
        '✅ কোনো pending recharge request নেই।',
      );
      return;
    }
    for (const r of pending.slice(0, 10)) {
      await this.adminTelegram.sendMessageWithButtons(
        [
          `💰 <b>Recharge Request #${r.id}</b>`,
          `🏪 ${tgEsc(r.page?.pageName ?? '?')} (page #${r.pageId})`,
          `👤 ${tgEsc(r.page?.owner?.username ?? '?')}`,
          `💵 ৳${r.amountBdt} → ${r.creditsAmount} credit | 📱 ${tgEsc(r.method)}`,
          `🔖 TrxID: <code>${tgEsc(r.transactionId)}</code>`,
        ].join('\n'),
        [
          [
            { text: '✅ Approve', callback_data: `recharge_approve_${r.id}` },
            { text: '❌ Reject', callback_data: `recharge_reject_${r.id}` },
          ],
        ],
      );
    }
    if (pending.length > 10) {
      await this.adminTelegram.sendMessage(
        `…আরো ${pending.length - 10}টা pending আছে।`,
      );
    }
  }

  private async cmdSetPageStatus(
    pageId: number,
    status: 'SUSPENDED' | 'ACTIVE',
  ): Promise<void> {
    if (!pageId || Number.isNaN(pageId)) {
      await this.adminTelegram.sendMessage(
        `⚠️ Page ID দিন — যেমন: <code>/${status === 'SUSPENDED' ? 'suspend' : 'activate'} 5</code>\nPage ID পেতে /pages পাঠান।`,
      );
      return;
    }
    await this.adminSvc().updatePageSubscription(pageId, {
      subscriptionStatus: status,
    });
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { pageName: true },
    });
    await this.adminTelegram.sendMessage(
      status === 'SUSPENDED'
        ? `🚫 Page #${pageId} <b>${tgEsc(page?.pageName ?? '')}</b> suspend করা হলো — bot বন্ধ।`
        : `✅ Page #${pageId} <b>${tgEsc(page?.pageName ?? '')}</b> activate করা হলো — bot চালু।`,
    );
  }

  private async cmdSetUserActive(
    username: string,
    isActive: boolean,
  ): Promise<void> {
    if (!username) {
      await this.adminTelegram.sendMessage(
        `⚠️ Username দিন — যেমন: <code>/${isActive ? 'unban' : 'ban'} limon123</code>`,
      );
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      await this.adminTelegram.sendMessage(
        `❌ User "${tgEsc(username)}" পাওয়া যায়নি।`,
      );
      return;
    }
    await this.adminSvc().setUserAccountStatus(user.id, isActive);
    await this.adminTelegram.sendMessage(
      isActive
        ? `✅ <b>${tgEsc(username)}</b> unban হলো — login করতে পারবে।`
        : `🚫 <b>${tgEsc(username)}</b> ban হলো — login বন্ধ।`,
    );
  }

  private async cmdProfit(month?: string): Promise<void> {
    const m =
      month && /^\d{4}-\d{2}$/.test(month)
        ? month
        : new Date().toISOString().slice(0, 7);
    const r = await this.adminSvc().getRevenueReport(m);
    const s = r.summary;
    const fmt = (n: number) => `৳${Math.round(n).toLocaleString()}`;
    const topPages = r.perPage
      .slice(0, 5)
      .map(
        (p: any, i: number) =>
          `${i + 1}. ${tgEsc(p.pageName)} — recharge ${fmt(p.rechargedBdt)}, usage ${fmt(p.billedBdt)}`,
      )
      .join('\n');
    const modelLines = (r.aiUsage?.byModel ?? [])
      .slice(0, 5)
      .map(
        (u: any) =>
          `• ${tgEsc(u.model)} (${u.usageType}): ${u.calls} call, ${((u.promptTokens + u.outputTokens) / 1000).toFixed(1)}K tokens = $${u.costUsd.toFixed(4)}`,
      )
      .join('\n');
    await this.adminTelegram.sendMessage(
      [
        `📈 <b>Profit Report — ${m}</b>`,
        '',
        `💵 Revenue (recharge): <b>${fmt(s.totalRevenueBdt)}</b>`,
        `📊 Usage billed: ${fmt(s.totalBilledBdt)}`,
        `🤖 Real AI cost (measured tokens): <b>${fmt(s.measuredApiCostBdt)}</b> ($${s.measuredApiCostUsd.toFixed(4)}, ${s.measuredCalls} calls)`,
        `🧮 Combined AI cost (measured + estimate): ${fmt(s.combinedApiCostBdt)}`,
        `💰 <b>Net Profit: ${fmt(s.netProfitBdt)}</b> (margin ${s.profitMarginPct.toFixed(1)}%)`,
        '',
        modelLines ? `<b>Model খরচ:</b>\n${modelLines}\n` : '',
        topPages ? `<b>Top pages:</b>\n${topPages}` : '',
        '',
        '<i>🧪 Test page-গুলো (নিজের page) এই হিসাবের বাইরে — মার্ক করতে /testpage &lt;pageId&gt;</i>',
        '<i>ℹ️ Gemini free-tier key ব্যবহার হলে আসল খরচ ৳0 পর্যন্ত হতে পারে — উপরের হিসাব official paid-rate ধরে।</i>',
      ]
        .filter((l) => l !== '')
        .join('\n'),
    );
  }

  private async handleAdminInlineAction(
    action: string,
    id: number,
    callbackQueryId: string,
  ): Promise<void> {
    try {
      if (action === 'suspend' && id) {
        await this.adminTelegram.answerCallback(
          callbackQueryId,
          `🚫 Suspending #${id}…`,
        );
        await this.cmdSetPageStatus(id, 'SUSPENDED');
      } else if (action === 'activate' && id) {
        await this.adminTelegram.answerCallback(
          callbackQueryId,
          `✅ Activating #${id}…`,
        );
        await this.cmdSetPageStatus(id, 'ACTIVE');
      } else if (action === 'users') {
        await this.adminTelegram.answerCallback(callbackQueryId);
        await this.cmdUsers(Number.isNaN(id) ? 0 : id);
      } else {
        await this.adminTelegram.answerCallback(
          callbackQueryId,
          '❓ Unknown action',
        );
      }
    } catch (err: any) {
      await this.adminTelegram.answerCallback(
        callbackQueryId,
        `❌ ${err?.message ?? 'Failed'}`,
      );
    }
  }

  /**
   * Approve/reject a wallet recharge request straight from the admin Telegram
   * bot's inline buttons. The approve path mirrors
   * AdminService.approveRechargeRequest — replicated here (not injected) because
   * AdminModule already imports TelegramModule, so injecting AdminService would
   * create a circular dependency.
   */
  private async handleRechargeAction(
    id: number,
    action: 'approve' | 'reject',
    callbackQueryId: string,
  ) {
    const req = await this.prisma.walletRechargeRequest.findUnique({
      where: { id },
    });
    if (!req) {
      await this.adminTelegram.answerCallback(
        callbackQueryId,
        '❌ Request not found',
      );
      return;
    }
    if (req.status !== 'pending') {
      await this.adminTelegram.answerCallback(
        callbackQueryId,
        `⏭️ Already ${req.status}`,
      );
      return;
    }

    if (action === 'reject') {
      await this.prisma.walletRechargeRequest.update({
        where: { id },
        data: { status: 'rejected', rejectedReason: 'Rejected via Telegram' },
      });
      await this.adminTelegram.answerCallback(callbackQueryId, '❌ Rejected');
      await this.adminTelegram.sendMessage(
        `❌ Recharge Request #${id} — rejected (via Telegram button)`,
      );
      return;
    }

    // approve — credit the wallet in one transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.page.update({
        where: { id: req.pageId },
        data: {
          creditBalance: { increment: req.creditsAmount },
          subscriptionStatus: 'ACTIVE',
        },
      });
      await tx.walletTransaction.create({
        data: {
          pageId: req.pageId,
          type: 'RECHARGE',
          amountCredit: req.creditsAmount,
          description: `${req.method.toUpperCase()} Recharge — ৳${req.amountBdt} → ${req.creditsAmount} credit (TrxID: ${req.transactionId})`,
        },
      });
      await tx.walletRechargeRequest.update({
        where: { id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: 'telegram-admin',
        },
      });
    });

    await this.adminTelegram.answerCallback(
      callbackQueryId,
      `✅ Approved! ${req.creditsAmount} credit added`,
    );
    await this.adminTelegram.sendMessage(
      `✅ <b>Recharge Approved</b>\nRequest #${id} — ${req.creditsAmount} credit balance যোগ হয়েছে (via Telegram)`,
    );
    // Notify the client on their page Telegram that the balance was added.
    void this.telegram.notify(
      req.pageId,
      `✅ <b>Wallet Recharge Approved</b>\n💰 ${req.creditsAmount} credit আপনার balance-এ যোগ হয়েছে। ধন্যবাদ! 🎉`,
    );
  }

  private async handleAdminPageRequestAction(
    id: number,
    action: 'reject',
    callbackQueryId: string,
  ) {
    const req = await this.prisma.pageRequest.findUnique({ where: { id } });
    if (!req) {
      await this.adminTelegram.answerCallback(
        callbackQueryId,
        '❌ Request not found',
      );
      return;
    }
    if (req.status !== 'pending') {
      await this.adminTelegram.answerCallback(
        callbackQueryId,
        `⏭️ Already ${req.status}`,
      );
      return;
    }
    await this.prisma.pageRequest.update({
      where: { id },
      data: { status: 'rejected' },
    });
    await this.adminTelegram.answerCallback(callbackQueryId, '❌ Rejected!');
    await this.adminTelegram.sendMessage(
      `❌ Page Request #${id} — rejected (via Telegram button)`,
    );
  }

  // ── Merchant Telegram command panel (per-page bot) ────────────────────────

  /** Start of "today" in Asia/Dhaka (fixed UTC+6, no DST). */
  private dhakaDayStart(): Date {
    const OFFSET = 6 * 60 * 60 * 1000;
    return new Date(
      Math.floor((Date.now() + OFFSET) / 86_400_000) * 86_400_000 - OFFSET,
    );
  }

  /** Start of the current month in Asia/Dhaka. */
  private dhakaMonthStart(): Date {
    const OFFSET = 6 * 60 * 60 * 1000;
    const dhakaNow = new Date(Date.now() + OFFSET);
    return new Date(
      Date.UTC(dhakaNow.getUTCFullYear(), dhakaNow.getUTCMonth(), 1) - OFFSET,
    );
  }

  private orderTotal(o: {
    items: Array<{ unitPrice: number; qty: number }>;
    deliveryFee?: number | null;
  }): number {
    const items = (o.items || []).reduce((s, i) => s + i.unitPrice * i.qty, 0);
    return items + (o.deliveryFee ?? 0);
  }

  private async handleMerchantCommand(
    pageId: number,
    pageName: string | null,
    token: string,
    chatId: string,
    textRaw: string,
  ): Promise<void> {
    // Permanent-keyboard buttons come back as their label text — map to command.
    const mapped = MERCHANT_BUTTON_COMMANDS[textRaw] ?? textRaw;
    const [cmdRaw] = mapped.split(/\s+/);
    const cmd = cmdRaw.toLowerCase().replace(/@.*$/, ''); // strip @botname suffix
    try {
      switch (cmd) {
        case '/start':
        case '/help':
          return await this.sendMerchantHelp(token, chatId, pageName);
        case '/today':
          return await this.merchantToday(pageId, token, chatId);
        case '/pending':
          return await this.merchantPending(pageId, token, chatId);
        case '/payments':
          return await this.merchantPayments(pageId, token, chatId);
        case '/report':
          return await this.merchantReport(pageId, token, chatId);
        case '/balance':
          return await this.merchantBalance(pageId, token, chatId);
        case '/products':
          return await this.merchantProducts(pageId, token, chatId);
        default:
          await this.telegram.sendRawWithKeyboard(
            token,
            chatId,
            '❓ বুঝতে পারিনি — নিচের বাটন ব্যবহার করুন বা /help পাঠান।',
            MERCHANT_KEYBOARD,
          );
      }
    } catch (err: any) {
      await this.telegram.sendRaw(
        token,
        chatId,
        `❌ Error: ${tgEsc(err?.message ?? err)}`,
      );
    }
  }

  private async sendMerchantHelp(
    token: string,
    chatId: string,
    pageName: string | null,
  ): Promise<void> {
    await this.telegram.sendRawWithKeyboard(
      token,
      chatId,
      [
        `🛍 <b>${tgEsc(pageName || 'FlamboyAI')} — Control Panel</b>`,
        '',
        'নিচের permanent বাটন থেকে এক চাপে সব কাজ করুন:',
        '',
        '🛒 আজকের অর্ডার — আজ কী কী অর্ডার এলো',
        '⏳ পেন্ডিং অর্ডার — confirm-এর অপেক্ষায় (Confirm/Courier বাটনসহ)',
        '💳 পেমেন্ট চেক — advance payment approve/reject',
        '📊 রিপোর্ট — আজ ও এই মাসের sales summary',
        '💰 ব্যালেন্স — wallet balance ও শেষ লেনদেন',
        '🛍 প্রোডাক্ট — প্রোডাক্ট list ও stock',
      ].join('\n'),
      MERCHANT_KEYBOARD,
    );
  }

  private merchantStatusEmoji(status: string): string {
    if (status === 'CONFIRMED') return '✅';
    if (status === 'CANCELLED') return '❌';
    if (status === 'DELIVERED') return '📦';
    if (status === 'ISSUE') return '⚠️';
    return '⏳';
  }

  private async merchantToday(
    pageId: number,
    token: string,
    chatId: string,
  ): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: { pageIdRef: pageId, createdAt: { gte: this.dhakaDayStart() } },
      include: { items: true },
      orderBy: { id: 'desc' },
      take: 20,
    });
    if (!orders.length) {
      await this.telegram.sendRaw(
        token,
        chatId,
        '🛒 আজ এখনো কোনো অর্ডার আসেনি।',
      );
      return;
    }
    const lines = orders.map((o) => {
      const total = Math.round(this.orderTotal(o));
      return `${this.merchantStatusEmoji(o.status)} <b>#${o.id}</b> ${tgEsc(o.customerName || '-')} — ৳${total} (${o.status})`;
    });
    await this.telegram.sendRaw(
      token,
      chatId,
      `🛒 <b>আজকের অর্ডার (${orders.length})</b>\n\n${lines.join('\n')}\n\nConfirm/Courier করতে "⏳ পেন্ডিং অর্ডার" চাপুন।`,
    );
  }

  private async merchantPending(
    pageId: number,
    token: string,
    chatId: string,
  ): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: { pageIdRef: pageId, status: { in: ['RECEIVED', 'PENDING'] } },
      include: { items: true },
      orderBy: { id: 'desc' },
      take: 10,
    });
    if (!orders.length) {
      await this.telegram.sendRaw(token, chatId, '✅ কোনো পেন্ডিং অর্ডার নেই।');
      return;
    }
    const lines = orders.map((o) => {
      const itemsTxt = o.items
        .map((i) => `${tgEsc(i.productName || i.productCode)}×${i.qty}`)
        .join(', ');
      return `⏳ <b>#${o.id}</b> ${tgEsc(o.customerName || '-')} | 📞 ${tgEsc(o.phone ?? '-')}\n   ${itemsTxt || '-'} — ৳${Math.round(this.orderTotal(o))}`;
    });
    // Reuses the existing confirm_/courier_ callback handlers.
    const buttons = orders.map((o) => [
      { text: `✅ Confirm #${o.id}`, callback_data: `confirm_${o.id}` },
      { text: `🚚 Courier #${o.id}`, callback_data: `courier_${o.id}` },
    ]);
    await this.telegram.sendRawWithButtons(
      token,
      chatId,
      `⏳ <b>পেন্ডিং অর্ডার (${orders.length})</b>\n\n${lines.join('\n')}`,
      buttons,
    );
  }

  private async merchantPayments(
    pageId: number,
    token: string,
    chatId: string,
  ): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        pageIdRef: pageId,
        paymentStatus: 'advance_paid',
        paymentVerifyStatus: 'pending_review',
      },
      select: {
        id: true,
        customerName: true,
        phone: true,
        transactionId: true,
      },
      orderBy: { id: 'desc' },
      take: 10,
    });
    if (!orders.length) {
      await this.telegram.sendRaw(
        token,
        chatId,
        '✅ কোনো payment check করার বাকি নেই।',
      );
      return;
    }
    const lines = orders.map(
      (o) =>
        `💳 <b>#${o.id}</b> ${tgEsc(o.customerName || '-')} | 📞 ${tgEsc(o.phone ?? '-')}\n   TrxID: <code>${tgEsc(o.transactionId ?? '-')}</code>`,
    );
    // Reuses the existing payok_/payfail_ callback handlers.
    const buttons = orders.map((o) => [
      { text: `✅ Approve #${o.id}`, callback_data: `payok_${o.id}` },
      { text: `❌ Reject #${o.id}`, callback_data: `payfail_${o.id}` },
    ]);
    await this.telegram.sendRawWithButtons(
      token,
      chatId,
      `💳 <b>Payment Check (${orders.length})</b>\n\n${lines.join('\n')}`,
      buttons,
    );
  }

  private async merchantReport(
    pageId: number,
    token: string,
    chatId: string,
  ): Promise<void> {
    const dayStart = this.dhakaDayStart();
    const orders = await this.prisma.order.findMany({
      where: { pageIdRef: pageId, createdAt: { gte: this.dhakaMonthStart() } },
      include: { items: true },
    });
    const calc = (list: typeof orders) => ({
      total: list.length,
      confirmed: list.filter(
        (o) => o.status === 'CONFIRMED' || o.status === 'DELIVERED',
      ).length,
      pending: list.filter((o) => ['RECEIVED', 'PENDING'].includes(o.status))
        .length,
      cancelled: list.filter((o) => o.status === 'CANCELLED').length,
      revenue: Math.round(
        list
          .filter((o) => o.status !== 'CANCELLED')
          .reduce((s, o) => s + this.orderTotal(o), 0),
      ),
    });
    const today = calc(orders.filter((o) => o.createdAt >= dayStart));
    const month = calc(orders);
    const section = (title: string, s: ReturnType<typeof calc>) =>
      [
        `<b>${title}</b>`,
        `🛒 অর্ডার: ${s.total} | ✅ Confirmed: ${s.confirmed}`,
        `⏳ Pending: ${s.pending} | ❌ Cancelled: ${s.cancelled}`,
        `💵 Sales (cancel বাদে): ৳${s.revenue.toLocaleString()}`,
      ].join('\n');
    await this.telegram.sendRaw(
      token,
      chatId,
      `📊 <b>Sales Report</b>\n\n${section('আজ', today)}\n\n${section('এই মাস', month)}`,
    );
  }

  private async merchantBalance(
    pageId: number,
    token: string,
    chatId: string,
  ): Promise<void> {
    const [page, txs] = await Promise.all([
      this.prisma.page.findUnique({
        where: { id: pageId },
        select: { creditBalance: true, subscriptionStatus: true },
      }),
      this.prisma.walletTransaction.findMany({
        where: { pageId },
        orderBy: { id: 'desc' },
        take: 5,
      }),
    ]);
    const balance = Math.round((page?.creditBalance ?? 0) * 100) / 100;
    const st =
      page?.subscriptionStatus === 'ACTIVE'
        ? '✅ ACTIVE'
        : `🚫 ${page?.subscriptionStatus ?? '?'}`;
    const txLines = txs.map((t) => {
      const amt = Math.round(Math.abs(t.amountCredit) * 100) / 100;
      return `${t.amountCredit >= 0 ? '➕' : '➖'} ${fmtNum(amt)} credit — ${tgEsc(t.description || t.type)}`;
    });
    await this.telegram.sendRaw(
      token,
      chatId,
      [
        '💰 <b>Wallet</b>',
        `Balance: <b>${fmtNum(balance)} credit</b>`,
        `Status: ${st}`,
        '',
        txLines.length
          ? `<b>শেষ ${txLines.length}টি লেনদেন:</b>\n${txLines.join('\n')}`
          : 'কোনো লেনদেন নেই।',
      ].join('\n'),
    );
  }

  private async merchantProducts(
    pageId: number,
    token: string,
    chatId: string,
  ): Promise<void> {
    const [products, totalCount] = await Promise.all([
      this.prisma.product.findMany({
        where: { pageId, isActive: true },
        select: { code: true, name: true, price: true, stockQty: true },
        orderBy: { id: 'desc' },
        take: 15,
      }),
      this.prisma.product.count({ where: { pageId } }),
    ]);
    if (!products.length) {
      await this.telegram.sendRaw(
        token,
        chatId,
        '🛍 কোনো প্রোডাক্ট নেই। Dashboard থেকে প্রোডাক্ট যোগ করুন।',
      );
      return;
    }
    const lines = products.map(
      (p) =>
        `• <code>${tgEsc(p.code)}</code> ${tgEsc(p.name || '-')} — ৳${fmtNum(p.price)} | Stock: ${p.stockQty}`,
    );
    await this.telegram.sendRaw(
      token,
      chatId,
      `🛍 <b>প্রোডাক্ট (${products.length}/${totalCount})</b>\n\n${lines.join('\n')}`,
    );
  }

  private async handleConfirm(
    pageId: number,
    orderId: number,
    token: string,
    callbackQueryId: string,
    chatId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef: pageId },
      include: { items: true },
    });
    if (!order) {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '❌ Order not found',
      );
      return;
    }
    if (order.status === 'CONFIRMED') {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '✅ Already confirmed',
      );
      return;
    }
    if (order.status === 'CANCELLED') {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '❌ Order is cancelled',
      );
      return;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });

    await this.telegram.answerCallback(
      token,
      callbackQueryId,
      '✅ Order confirmed!',
    );
    await this.telegram.sendRaw(
      token,
      chatId,
      `✅ <b>Order #${orderId} Confirmed!</b>\n👤 ${order.customerName}\n📞 ${order.phone ?? '-'}`,
    );
  }

  /**
   * Book the courier for an order straight from the Telegram button, using the
   * page's own courier settings (default courier + credentials configured on the
   * website). CourierService is resolved via ModuleRef to avoid a circular module
   * dependency (CourierModule → OrdersModule → TelegramModule).
   */
  private async handleCourierBook(
    pageId: number,
    orderId: number,
    token: string,
    callbackQueryId: string,
    chatId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef: pageId },
      include: { items: true },
    });
    if (!order) {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '❌ Order not found',
      );
      return;
    }
    if (order.status === 'CANCELLED') {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '❌ Order is cancelled',
      );
      return;
    }
    const existing = await this.prisma.courierShipment.findUnique({
      where: { orderId },
    });
    if (existing?.trackingId) {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        `✅ Already booked (${existing.trackingId})`,
      );
      return;
    }

    const courier = this.moduleRef.get(CourierService, { strict: false });
    const settings = courier.parseSettings(await courier.getSettings(pageId));
    if (!settings.defaultCourier || settings.defaultCourier === 'manual') {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '⚠️ Website-এ default courier setup করুন',
      );
      return;
    }

    const subtotal = (order.items || []).reduce(
      (s: number, i: any) => s + i.unitPrice * i.qty,
      0,
    );

    // Answer immediately (courier APIs can take a few seconds), then book.
    await this.telegram.answerCallback(
      token,
      callbackQueryId,
      `🚚 ${settings.defaultCourier}-এ পাঠানো হচ্ছে...`,
    );

    try {
      const shipment = await courier.bookShipment(pageId, {
        orderId,
        pageId,
        courier: settings.defaultCourier,
        recipientName: order.customerName || 'Customer',
        recipientPhone: order.phone || '',
        recipientAddress: order.address || '',
        codAmount: subtotal,
      });
      await this.telegram.sendRaw(
        token,
        chatId,
        `✅ <b>Order #${orderId} — Courier Booked</b> 🚚\n📦 ${settings.defaultCourier}\n🔖 Tracking: ${shipment?.trackingId || '-'}`,
      );
    } catch (err: any) {
      await this.telegram.sendRaw(
        token,
        chatId,
        `❌ Order #${orderId} courier booking failed: ${err?.message ?? err}`,
      );
    }
  }

  private async handleAdvanceRefund(
    pageId: number,
    returnId: number,
    subAction: string,
    token: string,
    callbackQueryId: string,
    chatId: string,
  ) {
    const returnEntry = await this.prisma.returnEntry.findFirst({
      where: { id: returnId, pageId },
      include: {
        order: {
          select: {
            id: true,
            customerPsid: true,
            customerName: true,
            phone: true,
            pageIdRef: true,
            page: { select: { pageToken: true, currencySymbol: true } },
          },
        },
      },
    });

    if (!returnEntry) {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '❌ Return entry not found',
      );
      return;
    }
    if (returnEntry.refundStatus === 'given') {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '✅ Already refunded',
      );
      return;
    }
    if (returnEntry.refundStatus === 'not_applicable') {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '⏭️ Already skipped',
      );
      return;
    }

    const sym = returnEntry.order.page?.currencySymbol || '৳';
    const amount = returnEntry.refundAmount;

    if (subAction === 'skip') {
      await this.prisma.returnEntry.update({
        where: { id: returnId },
        data: { refundStatus: 'not_applicable' },
      });
      await this.telegram.answerCallback(token, callbackQueryId, '⏭️ Skipped');
      await this.telegram.sendRaw(
        token,
        chatId,
        `⏭️ Advance refund for Order #${returnEntry.orderId} marked as N/A`,
      );
      return;
    }

    // subAction === 'confirm'
    await this.prisma.returnEntry.update({
      where: { id: returnId },
      data: {
        refundStatus: 'given',
        refundGivenAt: new Date(),
        refundGivenAmount: amount,
        refundMethod: 'bkash_manual',
      },
    });

    // Send customer Messenger message
    const psid = returnEntry.order.customerPsid;
    const pageToken = returnEntry.order.page?.pageToken;
    if (psid && pageToken) {
      const msg = `✅ আপনার অর্ডার #${returnEntry.orderId} এর অগ্রিম ${sym}${amount} ফেরত পাঠানো হয়েছে। ধন্যবাদ! 💖`;
      await this.messenger.sendText(pageToken, psid, msg, 'ACCOUNT_UPDATE');
    }

    await this.telegram.answerCallback(
      token,
      callbackQueryId,
      `✅ Refund confirmed! ${sym}${amount}`,
    );
    await this.telegram.sendRaw(
      token,
      chatId,
      `✅ <b>Refund Confirmed</b>\nOrder #${returnEntry.orderId} — ${returnEntry.order.customerName || 'Customer'}\n💰 ${sym}${amount} refunded`,
    );
  }

  /**
   * Approve/reject a manual advance payment (trxID/screenshot) straight from
   * the Telegram button. Delegates to OrdersService.verifyPayment — the same
   * path the dashboard uses — so approve also confirms the order and sends the
   * customer their confirmation message. OrdersService is resolved via
   * ModuleRef to avoid the OrdersModule → TelegramModule circular dependency.
   */
  private async handlePaymentVerify(
    pageId: number,
    orderId: number,
    approve: boolean,
    token: string,
    callbackQueryId: string,
    chatId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef: pageId },
      select: {
        id: true,
        customerName: true,
        phone: true,
        customerPsid: true,
        paymentStatus: true,
        paymentVerifyStatus: true,
        transactionId: true,
        page: { select: { pageToken: true } },
      },
    });
    if (!order) {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '❌ Order not found',
      );
      return;
    }
    if (order.paymentStatus !== 'advance_paid') {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '⚠️ এই order-এ কোনো advance payment নেই',
      );
      return;
    }
    if (order.paymentVerifyStatus === 'verified') {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '✅ Already approved',
      );
      return;
    }
    if (!approve && order.paymentVerifyStatus === 'verify_failed') {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '❌ Already rejected',
      );
      return;
    }

    const orders = this.moduleRef.get(OrdersService, { strict: false });

    if (approve) {
      try {
        // verifyPayment('verified') also confirms the order, messages the
        // customer (order_confirmed template) and sends the merchant a
        // Telegram summary — no extra sends needed here.
        await orders.verifyPayment(orderId, 'verified', pageId);
        await this.telegram.answerCallback(
          token,
          callbackQueryId,
          '✅ Payment approved!',
        );
      } catch (err: any) {
        await this.telegram.answerCallback(
          token,
          callbackQueryId,
          `❌ ${err?.message ?? 'Failed'}`,
        );
      }
      return;
    }

    try {
      await orders.verifyPayment(orderId, 'verify_failed', pageId);
    } catch (err: any) {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        `❌ ${err?.message ?? 'Failed'}`,
      );
      return;
    }
    await this.telegram.answerCallback(
      token,
      callbackQueryId,
      '❌ Payment rejected',
    );
    await this.telegram.sendRaw(
      token,
      chatId,
      `❌ <b>Payment Rejected</b> — Order #${orderId}\n👤 ${order.customerName || 'Customer'} | 📞 ${order.phone ?? '-'}\n💳 Proof: ${order.transactionId ?? '-'}\nCustomer-কে জানানো হয়েছে সঠিক Transaction ID পাঠাতে।`,
    );
    // Tell the customer politely so they can re-send the correct proof
    if (order.customerPsid && order.page?.pageToken) {
      const msg = `দুঃখিত, আপনার অর্ডার #${orderId}-এর payment টি আমরা verify করতে পারিনি 😔 অনুগ্রহ করে Transaction ID টি আবার check করে পাঠান, অথবা payment-এর screenshot দিন 💖`;
      await this.messenger
        .sendText(
          order.page.pageToken,
          order.customerPsid,
          msg,
          'ACCOUNT_UPDATE',
        )
        .catch(() => {});
    }
  }

  private async handleFraud(
    pageId: number,
    orderId: number,
    token: string,
    callbackQueryId: string,
    chatId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, pageIdRef: pageId },
      select: {
        id: true,
        customerName: true,
        phone: true,
        spamRisk: true,
        spamScore: true,
        spamTotalOrders: true,
        spamDelivered: true,
        spamCancelled: true,
      },
    });
    if (!order) {
      await this.telegram.answerCallback(
        token,
        callbackQueryId,
        '❌ Order not found',
      );
      return;
    }

    const riskEmoji =
      order.spamRisk === 'high'
        ? '🔴'
        : order.spamRisk === 'medium'
          ? '🟡'
          : order.spamRisk === 'low'
            ? '🟢'
            : '⚪';
    const total = order.spamTotalOrders ?? 0;
    const delivered = order.spamDelivered ?? 0;
    const cancelled = order.spamCancelled ?? 0;

    const msg = [
      `🔍 <b>Fraud Check — Order #${order.id}</b>`,
      `👤 ${order.customerName} | 📞 ${order.phone ?? '-'}`,
      `${riskEmoji} Risk: <b>${(order.spamRisk ?? 'unknown').toUpperCase()}</b>`,
      total > 0
        ? `📊 Total: ${total} | ✅ Delivered: ${delivered} | ❌ Cancelled: ${cancelled}`
        : `📊 No order history found`,
    ].join('\n');

    await this.telegram.answerCallback(
      token,
      callbackQueryId,
      `${riskEmoji} Risk: ${order.spamRisk ?? 'unknown'}`,
    );
    await this.telegram.sendRaw(token, chatId, msg);
  }
}
