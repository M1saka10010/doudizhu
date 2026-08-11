import type { Card } from '../../game/types';
import { cardToken } from '../../game/cards';
import { decideBid, decidePlay } from './decision';

export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface PlayerInfo {
  name: string;
  remaining: number;
}

export interface BidContext {
  config: AiSettings;
  seat: number;
  hand: Card[];
  bidOrder: number[];
  bidPosition: number;
  previousBids: (boolean | null)[];
  players: PlayerInfo[];
}

export interface PlayContext {
  config: AiSettings;
  seat: number;
  hand: Card[];
  lastPlay: { ownerSeat: number; cards: string[] } | null;
  landlordSeat: number;
  players: PlayerInfo[];
  /** 本局已出的每一手牌 (供 AI 推断场上剩余牌) */
  history?: { ownerSeat: number; cards: string[] }[];
}

export interface BidDecision {
  action: 'call' | 'pass';
  reason?: string;
  /** thinking 模型的思考过程 (若有) */
  reasoning?: string;
}

export interface PlayDecision {
  action: 'play' | 'pass';
  cards: string[];
  reason?: string;
  shapeName?: string;
  /** thinking 模型的思考过程 (若有) */
  reasoning?: string;
}

const SETTINGS_KEY = 'doudizhu-ai-settings';

export function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // 忽略损坏的本地配置
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: AiSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export const DEFAULT_SETTINGS: AiSettings = { baseUrl: '', apiKey: '', model: '' };

function directRequestError(error: unknown): never {
  if (error instanceof TypeError)
    throw new Error('浏览器无法连接模型接口。请检查 Base URL、网络以及接口是否允许跨域请求 (CORS)');
  throw error;
}

export async function aiBid(ctx: BidContext, signal?: AbortSignal): Promise<BidDecision> {
  try {
    const result = await decideBid({
      config: ctx.config,
      seat: ctx.seat,
      hand: ctx.hand.map(cardToken),
      bidOrder: ctx.bidOrder,
      bidPosition: ctx.bidPosition,
      previousBids: ctx.previousBids,
      players: ctx.players,
    }, signal);
    return {
      action: result.action === 'call' ? 'call' : 'pass',
      reason: result.reason,
      reasoning: result.reasoning,
    };
  } catch (error) {
    directRequestError(error);
  }
}

export async function aiPlay(ctx: PlayContext, signal?: AbortSignal): Promise<PlayDecision> {
  try {
    const result = await decidePlay({
      config: ctx.config,
      seat: ctx.seat,
      hand: ctx.hand.map(cardToken),
      lastPlay: ctx.lastPlay,
      landlordSeat: ctx.landlordSeat,
      players: ctx.players,
      history: ctx.history,
    }, signal);
    return {
      action: result.action === 'play' ? 'play' : 'pass',
      cards: result.cards,
      reason: result.reason,
      shapeName: result.shapeName,
      reasoning: result.reasoning,
    };
  } catch (error) {
    directRequestError(error);
  }
}

/** 用 OpenAI 兼容的 models 接口检测地址、密钥和浏览器 CORS。 */
export async function checkAiConnection(settings: AiSettings): Promise<void> {
  const base = settings.baseUrl.trim().replace(/\/+$/, '');
  if (!base || !settings.apiKey || !settings.model.trim())
    throw new Error('请先完整填写 Base URL、API Key 和模型');
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`接口返回 HTTP ${res.status}`);
  } catch (error) {
    directRequestError(error);
  }
}
