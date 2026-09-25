import { Injectable } from '@nestjs/common';
import { promises as fs, readFileSync } from 'fs';
import { join } from 'path';

export interface ApiKeysConfig {
  // AI
  openaiApiKey?: string;
  geminiApiKey?: string;
  geminiApiKeys?: string; // JSON array of multiple Gemini keys for rotation
  openrouterApiKey?: string;
  openrouterModel?: string;
  aiProviderPriority?: string; // JSON array, e.g. '["gemini","openai","openrouter"]'
  ollamaBaseUrl?: string;
  ollamaChatModel?: string;
  ollamaVisionModel?: string;
  aiIntentProvider?: string;
  aiIntentModel?: string;
  // Vision
  visionProvider?: string;
  visionModel?: string;
  openaiVisionModel?: string;
  visionConfidenceThreshold?: string;
  // Fallback AI
  fallbackAiProvider?: string;
  fallbackAiModel?: string;
  // OpenAI text model
  openaiModel?: string;
  // Gmail (legacy — SMTP is blocked on most VPS providers, prefer Resend)
  gmailUser?: string;
  gmailAppPassword?: string;
  // Resend (OTP/email — HTTP API, works even when SMTP ports are blocked)
  resendApiKey?: string;
  resendFromEmail?: string;
  // Facebook OAuth (global app)
  fbAppId?: string;
  fbAppSecret?: string;
  fbOauthStateSecret?: string;
  fbRedirectUri?: string;
  // Image generation
  falApiKey?: string;
  falApiKey2?: string;
  falApiKey3?: string;
  ideogramApiKey?: string;
  // TTS / Voice
  elevenlabsApiKey?: string;
  googleTtsKeyFile?: string;
  // Call integrations
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  twilioTwimlBase?: string;
  sslWirelessApiKey?: string;
  sslWirelessApiUrl?: string;
  sslWirelessCallerId?: string;
  bdCallingApiKey?: string;
  bdCallingApiUrl?: string;
  bdCallingCallerId?: string;
  // Telegram
  telegramBotToken?: string;
  telegramChatId?: string;
  // Misc
  landingPageUrl?: string;
  catalogBaseUrl?: string;
  storagePublicUrl?: string;
  apiBaseUrl?: string;
  // Shown to clients whose page type has no matching bot agent yet, so they
  // can reach admin over WhatsApp to get a custom bot configured.
  adminWhatsappNumber?: string;
}

const DEFAULT_ADMIN_WHATSAPP_NUMBER = '01575897887';

const FILE = join(process.cwd(), 'storage', 'settings', 'api-keys.json');

/** Maps ApiKeysConfig field → process.env variable name */
const ENV_MAP: Record<keyof ApiKeysConfig, string> = {
  openaiApiKey: 'OPENAI_API_KEY',
  geminiApiKey: 'GEMINI_API_KEY',
  geminiApiKeys: 'GEMINI_API_KEYS',
  openrouterApiKey: 'OPENROUTER_API_KEY',
  openrouterModel: 'OPENROUTER_MODEL',
  aiProviderPriority: 'AI_PROVIDER_PRIORITY',
  ollamaBaseUrl: 'OLLAMA_BASE_URL',
  ollamaChatModel: 'OLLAMA_CHAT_MODEL',
  ollamaVisionModel: 'OLLAMA_VISION_MODEL',
  aiIntentProvider: 'AI_INTENT_PROVIDER',
  aiIntentModel: 'AI_INTENT_MODEL',
  visionProvider: 'VISION_PROVIDER',
  visionModel: 'VISION_MODEL',
  openaiVisionModel: 'OPENAI_VISION_MODEL',
  visionConfidenceThreshold: 'VISION_CONFIDENCE_THRESHOLD',
  fallbackAiProvider: 'FALLBACK_AI_PROVIDER',
  fallbackAiModel: 'FALLBACK_AI_MODEL',
  openaiModel: 'OPENAI_MODEL',
  gmailUser: 'GMAIL_USER',
  gmailAppPassword: 'GMAIL_APP_PASSWORD',
  resendApiKey: 'RESEND_API_KEY',
  resendFromEmail: 'RESEND_FROM_EMAIL',
  fbAppId: 'FB_APP_ID',
  fbAppSecret: 'FB_APP_SECRET',
  fbOauthStateSecret: 'FB_OAUTH_STATE_SECRET',
  fbRedirectUri: 'FB_REDIRECT_URI',
  falApiKey: 'FAL_API_KEY',
  falApiKey2: 'FAL_API_KEY_2',
  falApiKey3: 'FAL_API_KEY_3',
  ideogramApiKey: 'IDEOGRAM_API_KEY',
  elevenlabsApiKey: 'ELEVENLABS_API_KEY',
  googleTtsKeyFile: 'GOOGLE_TTS_KEY_FILE',
  twilioAccountSid: 'TWILIO_ACCOUNT_SID',
  twilioAuthToken: 'TWILIO_AUTH_TOKEN',
  twilioFromNumber: 'TWILIO_FROM_NUMBER',
  twilioTwimlBase: 'TWILIO_TWIML_BASE',
  sslWirelessApiKey: 'SSLWIRELESS_API_KEY',
  sslWirelessApiUrl: 'SSLWIRELESS_API_URL',
  sslWirelessCallerId: 'SSLWIRELESS_CALLER_ID',
  bdCallingApiKey: 'BDCALLING_API_KEY',
  bdCallingApiUrl: 'BDCALLING_API_URL',
  bdCallingCallerId: 'BDCALLING_CALLER_ID',
  telegramBotToken: 'TELEGRAM_BOT_TOKEN',
  telegramChatId: 'TELEGRAM_CHAT_ID',
  landingPageUrl: 'LANDING_PAGE_URL',
  catalogBaseUrl: 'CATALOG_BASE_URL',
  storagePublicUrl: 'STORAGE_PUBLIC_URL',
  apiBaseUrl: 'API_BASE_URL',
  adminWhatsappNumber: 'ADMIN_WHATSAPP_NUMBER',
};

/** Fields that should be masked (***) when returned to the frontend */
export const SECRET_FIELDS = new Set<keyof ApiKeysConfig>([
  'openaiApiKey',
  'geminiApiKey',
  'geminiApiKeys',
  'openrouterApiKey',
  'gmailAppPassword',
  'resendApiKey',
  'fbAppSecret',
  'fbOauthStateSecret',
  'falApiKey',
  'falApiKey2',
  'falApiKey3',
  'ideogramApiKey',
  'elevenlabsApiKey',
  'twilioAuthToken',
  'sslWirelessApiKey',
  'bdCallingApiKey',
  'telegramBotToken',
]);

@Injectable()
export class ApiKeysService {
  private cache: ApiKeysConfig;

  constructor() {
    try {
      const raw = readFileSync(FILE, 'utf8');
      this.cache = JSON.parse(raw) as ApiKeysConfig;
    } catch {
      this.cache = {};
    }
  }

  private async ensureDir() {
    await fs.mkdir(join(process.cwd(), 'storage', 'settings'), { recursive: true });
  }

  /** Get a single key synchronously — file overrides env fallback */
  getSync(field: keyof ApiKeysConfig): string {
    const fileVal = this.cache[field] as string | undefined;
    if (fileVal && fileVal.trim()) return fileVal.trim();
    const envVal = process.env[ENV_MAP[field]];
    if (envVal) return envVal;
    if (field === 'adminWhatsappNumber') return DEFAULT_ADMIN_WHATSAPP_NUMBER;
    return '';
  }

  /** Async alias for consistency */
  async get(field: keyof ApiKeysConfig): Promise<string> {
    return this.getSync(field);
  }

  /** Get all keys (file values merged over env defaults) */
  async getAll(): Promise<ApiKeysConfig> {
    const merged: ApiKeysConfig = {};
    for (const field of Object.keys(ENV_MAP) as (keyof ApiKeysConfig)[]) {
      (merged as any)[field] = this.getSync(field);
    }
    return merged;
  }

  /** Get all keys but mask secrets for frontend display */
  async getAllMasked(): Promise<Record<string, string>> {
    const all = await this.getAll();
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (SECRET_FIELDS.has(k as keyof ApiKeysConfig) && v) {
        result[k] = '***SAVED***';
      } else {
        result[k] = v as string;
      }
    }
    return result;
  }

  /** Save a partial update. Empty string = clear override (fall back to env) */
  async set(patch: Partial<ApiKeysConfig>): Promise<{ ok: boolean }> {
    await this.ensureDir();
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === null || v === undefined) {
        delete (this.cache as any)[k];
      } else if (v === '***SAVED***') {
        // skip — keep existing value
      } else if (k === 'geminiApiKeys') {
        // Merge: replace ***SAVED*** placeholders with existing stored keys
        try {
          const incoming: string[] = JSON.parse(v as string);
          let existing: string[] = [];
          try { existing = JSON.parse(this.cache.geminiApiKeys ?? '[]'); } catch {}
          const merged = incoming.map((entry) => {
            if (entry === '***SAVED***') return existing[0] ?? '';
            const keepMatch = entry.match(/^\*\*\*SAVED:(\d+)\*\*\*$/);
            if (keepMatch) return existing[parseInt(keepMatch[1])] ?? '';
            return entry;
          }).filter(Boolean);
          this.cache.geminiApiKeys = merged.length > 0 ? JSON.stringify(merged) : undefined;
          if (!this.cache.geminiApiKeys) delete this.cache.geminiApiKeys;
        } catch {
          (this.cache as any)[k] = v;
        }
      } else {
        (this.cache as any)[k] = v;
      }
    }
    await fs.writeFile(FILE, JSON.stringify(this.cache, null, 2), 'utf8');
    return { ok: true };
  }
}
