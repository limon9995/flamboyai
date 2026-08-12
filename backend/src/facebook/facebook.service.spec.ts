import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FacebookService } from './facebook.service';

describe('FacebookService', () => {
  let service: FacebookService;
  let prisma: any;
  let authService: any;
  let encryption: any;
  let billing: any;
  let telegram: any;
  let mailer: any;

  beforeEach(() => {
    process.env.STORAGE_PUBLIC_URL = 'https://api.flamboyai.com/storage';
    process.env.FB_APP_ID = 'test-app-id';
    process.env.FB_OAUTH_STATE_SECRET = 'test-state-secret';
    prisma = {
      page: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      pageRequest: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    authService = {
      addPageToUser: jest.fn(),
      removePageFromUser: jest.fn(),
    };
    encryption = {
      encryptIfNeeded: jest.fn((value: string) => `ENC:${value}`),
    };
    billing = {
      getOrCreateSubscription: jest.fn().mockResolvedValue({ plan: null }),
    };
    telegram = {
      sendMessage: jest.fn(),
      sendMessageWithButtons: jest.fn(),
    };
    mailer = {
      sendMail: jest.fn(),
    };
    service = new FacebookService(
      prisma,
      authService,
      encryption,
      billing,
      telegram,
      mailer,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.STORAGE_PUBLIC_URL;
    delete process.env.FB_APP_ID;
    delete process.env.FB_OAUTH_STATE_SECRET;
  });

  it('rejects manual page connect when submitted pageId does not match token owner page', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: '1046542211868208', name: 'Limon Tech Diary' }),
    } as any);

    await expect(
      service.connectPage('user-1', {
        pageId: '10465422118868208',
        pageName: 'Wrong Name',
        pageToken: 'token-123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.page.findUnique).not.toHaveBeenCalled();
    expect(prisma.page.create).not.toHaveBeenCalled();
  });

  it('stores the verified page identity instead of trusting submitted values', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: '1046542211868208', name: 'Limon Tech Diary' }),
    } as any);
    prisma.page.findUnique.mockResolvedValue(null);
    prisma.page.create.mockResolvedValue({
      id: 1,
      pageId: '1046542211868208',
      pageName: 'Limon Tech Diary',
      verifyToken: 'verify-1',
    });

    const result = await service.connectPage('user-1', {
      pageId: '1046542211868208',
      pageName: 'User Typed Name',
      pageToken: 'token-123',
    });

    expect(prisma.page.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pageId: '1046542211868208',
        pageName: 'Limon Tech Diary',
        pageToken: 'ENC:token-123',
      }),
    });
    expect(authService.addPageToUser).toHaveBeenCalledWith('user-1', 1);
    expect(result.page.pageId).toBe('1046542211868208');
    expect(result.page.pageName).toBe('Limon Tech Diary');
    expect(result.webhookUrl).toBe('https://api.flamboyai.com/webhook');
  });

  it('blocks connect when the verified page already belongs to another user', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: '1046542211868208', name: 'Limon Tech Diary' }),
    } as any);
    prisma.page.findUnique.mockResolvedValue({
      id: 1,
      ownerId: 'other-user',
      verifyToken: 'verify-1',
    });

    await expect(
      service.connectPage('user-1', {
        pageId: '1046542211868208',
        pageName: 'Limon Tech Diary',
        pageToken: 'token-123',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('resolves page identity from a page link and returns verified page values', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '1046542211868208',
          name: 'Limon Tech Diary',
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '1046542211868208',
          name: 'Limon Tech Diary',
        }),
      } as any);

    const result = await service.resolvePageIdentity(
      'https://www.facebook.com/LimonTechDiary',
      'token-123',
    );

    expect(result).toEqual({
      pageId: '1046542211868208',
      pageName: 'Limon Tech Diary',
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        '/LimonTechDiary?fields=id,name&access_token=token-123',
      ),
    );
  });

  it('rejects page links that resolve to a different page than the supplied token', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '1046542211868208',
          name: 'Limon Tech Diary',
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '123456789012345', name: 'Wrong Page' }),
      } as any);

    await expect(
      service.resolvePageIdentity(
        'https://www.facebook.com/WrongPage',
        'token-123',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts numeric profile-style links when the id matches the verified page id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: '61550984030942', name: 'Limon Tech Diary' }),
    } as any);

    const result = await service.resolvePageIdentity(
      'https://www.facebook.com/profile.php?id=61550984030942',
      'token-123',
    );

    expect(result).toEqual({
      pageId: '61550984030942',
      pageName: 'Limon Tech Diary',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects numeric profile-style links when the id does not match the verified page id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: '1046542211868208', name: 'Limon Tech Diary' }),
    } as any);

    await expect(
      service.resolvePageIdentity(
        'https://www.facebook.com/profile.php?id=61550984030942',
        'token-123',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FacebookService — admin moderator-access approval', () => {
  let service: FacebookService;
  let prisma: any;
  let authService: any;
  let encryption: any;
  let billing: any;
  let telegram: any;
  let mailer: any;

  beforeEach(() => {
    process.env.FB_APP_ID = 'test-app-id';
    process.env.FB_OAUTH_STATE_SECRET = 'test-state-secret';
    prisma = {
      page: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      pageRequest: { findUnique: jest.fn(), update: jest.fn() },
    };
    authService = { addPageToUser: jest.fn(), removePageFromUser: jest.fn() };
    encryption = { encryptIfNeeded: jest.fn((v: string) => `ENC:${v}`) };
    billing = { getOrCreateSubscription: jest.fn().mockResolvedValue({ plan: null }) };
    telegram = { sendMessage: jest.fn(), sendMessageWithButtons: jest.fn() };
    mailer = { sendMail: jest.fn() };
    service = new FacebookService(prisma, authService, encryption, billing, telegram, mailer);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.FB_APP_ID;
    delete process.env.FB_OAUTH_STATE_SECRET;
  });

  it('embeds a signed, purpose-tagged, round-trippable state in the admin approve URL', () => {
    const url = service.getAdminApproveUrl(42);
    const stateParam = new URL(url).searchParams.get('state')!;
    const [payloadB64] = stateParam.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    expect(payload.purpose).toBe('admin_approve_page_request');
    expect(payload.pageRequestId).toBe(42);
    expect(typeof payload.ts).toBe('number');
  });

  it('auto-connects when the admin moderates exactly one page (single-candidate shortcut)', async () => {
    const req = {
      id: 5,
      userId: 'user-1',
      pageUrl: 'https://facebook.com/myshop',
      status: 'pending',
      user: { name: 'Limon', email: 'limon@example.com' },
    };
    prisma.pageRequest.findUnique.mockResolvedValue(req);
    jest.spyOn(service, 'connectPage').mockResolvedValue({
      success: true,
      page: { id: 42, pageId: '999', pageName: 'My Shop' },
      webhookUrl: 'https://api.flamboyai.com/webhook',
    } as any);

    const result = await service.approvePageRequestViaFacebookLogin(5, [
      { pageId: '999', pageName: 'My Shop', pageToken: 'tok' },
    ]);

    expect(result).toEqual({ status: 'connected', pageName: 'My Shop' });
    expect(service.connectPage).toHaveBeenCalledWith('user-1', {
      pageId: '999',
      pageName: 'My Shop',
      pageToken: 'tok',
    });
    expect(prisma.pageRequest.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { status: 'approved', connectedPageId: 42 },
    });
    expect(mailer.sendMail).toHaveBeenCalledWith(
      'limon@example.com',
      expect.any(String),
      expect.any(String),
    );
  });

  it('falls back to a manual picker when none of the admin\'s pages match the request URL', async () => {
    prisma.pageRequest.findUnique.mockResolvedValue({
      id: 6,
      userId: 'user-1',
      pageUrl: 'https://facebook.com/myshop',
      status: 'pending',
      user: { name: 'Limon', email: '' },
    });

    // URL vanity rarely equals the page NAME — instead of dead-ending on
    // no_match, every page from the login is offered so the admin can pick.
    const result: any = await service.approvePageRequestViaFacebookLogin(6, [
      { pageId: '111', pageName: 'Other Page A', pageToken: 'tok' },
      { pageId: '222', pageName: 'Other Page B', pageToken: 'tok2' },
    ]);

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
    expect(result.requestedUrl).toBe('https://facebook.com/myshop');
  });

  it('returns no_match only when Facebook returned zero manageable pages', async () => {
    prisma.pageRequest.findUnique.mockResolvedValue({
      id: 6,
      userId: 'user-1',
      pageUrl: 'https://facebook.com/myshop',
      status: 'pending',
      user: { name: 'Limon', email: '' },
    });

    const result = await service.approvePageRequestViaFacebookLogin(6, []);

    expect(result).toEqual({ status: 'no_match' });
  });

  it('returns an ambiguous picker when the request page matches multiple candidates', async () => {
    prisma.pageRequest.findUnique.mockResolvedValue({
      id: 7,
      userId: 'user-1',
      pageUrl: 'https://facebook.com/myshop',
      status: 'pending',
      user: { name: 'Limon', email: '' },
    });

    const result: any = await service.approvePageRequestViaFacebookLogin(7, [
      { pageId: '111', pageName: 'MyShop', pageToken: 'tok' },
      { pageId: '222', pageName: 'myshop', pageToken: 'tok2' },
    ]);

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
    expect(typeof result.resultId).toBe('string');
  });

  it('finalizes an ambiguous approval once the admin picks a page', async () => {
    prisma.pageRequest.findUnique.mockResolvedValue({
      id: 7,
      userId: 'user-1',
      pageUrl: 'https://facebook.com/myshop',
      status: 'pending',
      user: { name: 'Limon', email: '' },
    });

    const ambiguous: any = await service.approvePageRequestViaFacebookLogin(7, [
      { pageId: '111', pageName: 'MyShop', pageToken: 'tok' },
      { pageId: '222', pageName: 'myshop', pageToken: 'tok2' },
    ]);

    jest.spyOn(service, 'connectPage').mockResolvedValue({
      success: true,
      page: { id: 55, pageId: '222', pageName: 'myshop' },
      webhookUrl: 'https://api.flamboyai.com/webhook',
    } as any);

    const result = await service.finalizeAmbiguousApproval(ambiguous.resultId, '222');

    expect(result).toEqual({ status: 'connected', pageName: 'myshop' });
    expect(service.connectPage).toHaveBeenCalledWith('user-1', {
      pageId: '222',
      pageName: 'myshop',
      pageToken: 'tok2',
    });
  });

  it('rejects finalizing an unknown or expired ambiguous-approval session', async () => {
    await expect(
      service.finalizeAmbiguousApproval('does-not-exist', '222'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects approving a request that is no longer pending', async () => {
    prisma.pageRequest.findUnique.mockResolvedValue({
      id: 8,
      userId: 'user-1',
      pageUrl: 'https://facebook.com/myshop',
      status: 'approved',
      user: { name: 'Limon', email: '' },
    });

    await expect(
      service.approvePageRequestViaFacebookLogin(8, [
        { pageId: '1', pageName: 'X', pageToken: 't' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
