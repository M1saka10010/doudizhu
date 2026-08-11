import type { Card } from '../../game/types';
import { canBeat, classify, getPlays, HAND_NAMES } from '../../game/rules';
import { cardLabel, cardToken, handText, tokenToCard } from '../../game/cards';

export interface AiConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface AiPlayerInfo {
  name: string;
  remaining: number;
}

export interface AiBidRequest {
  config?: AiConfig;
  /** 自己座位 0..2 */
  seat: number;
  /** 手牌 tokens */
  hand: string[];
  /** 叫地主顺序 (座位数组) */
  bidOrder: number[];
  /** 自己在叫地主顺序中的位置 0..2 */
  bidPosition: number;
  /** 前面各家已给出的决定 (按 bidOrder 顺序, 未到为 null) */
  previousBids: (boolean | null)[];
  players: AiPlayerInfo[];
}

export interface AiPlayRequest {
  config?: AiConfig;
  seat: number;
  hand: string[];
  /** 上家出的牌 (null = 先手) */
  lastPlay: { ownerSeat: number; cards: string[] } | null;
  landlordSeat: number;
  players: AiPlayerInfo[];
  /** 本局已出的每一手牌 */
  history?: { ownerSeat: number; cards: string[] }[];
}

export interface AiDecision {
  action: 'play' | 'pass' | 'call';
  /** play 时为出的牌 tokens */
  cards: string[];
  reason?: string;
  /** thinking 模型的思考过程 (若有) */
  reasoning?: string;
  /** play 时的牌型 (供展示) */
  shapeName?: string;
  attempts: number;
}

export class AiError extends Error {}

type ChatMessage = Record<string, unknown>;

const DEFAULT_DECISION_TIMEOUT_MS = 300_000;
const MAX_DECISION_TOKENS = 128_000;
let currentDecisionTimeoutMs = DEFAULT_DECISION_TIMEOUT_MS;

function decisionTimeoutMs(): number {
  return currentDecisionTimeoutMs;
}

/** 仅供自动化测试缩短等待；不在应用代码中调用。 */
export function setDecisionTimeoutForTesting(timeoutMs?: number): void {
  currentDecisionTimeoutMs = timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
}

interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const BID_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'decide_bid',
    description: '决定是否叫地主',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['call', 'pass'],
          description: '"call"=叫地主, "pass"=不叫',
        },
        reason: { type: 'string', description: '简要理由(中文, 一句话)' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
};

const PLAY_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'play_cards',
    description: '选择要出的牌',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['play', 'pass'],
          description: '"play"=出牌, "pass"=不出',
        },
        cards: {
          type: 'array',
          items: { type: 'string' },
          description: '要出的牌(牌编码列表, 如 ["3S","10H","SJ"]), 不出时为 []',
        },
        reason: { type: 'string', description: '简要理由(中文, 一句话)' },
      },
      required: ['action', 'cards'],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `你是《斗地主》的一名 AI 玩家, 根据当前局面调用工具做出决策。

【牌型】
- 单张 / 对子 / 三张 / 三带一(三张+1张单牌) / 三带二(三张+1对)
- 顺子: >=5 张点数连续的单牌(不能含 2 和大小王)
- 连对: >=3 对点数连续的对子(不能含 2 和大小王)
- 飞机: >=2 组点数连续的三张(不能含 2 和大小王), 可带等量单张(飞机带单)或等量对子(飞机带对)
- 四带二(四张+任意2张) / 四带两对(四张+2对)
- 炸弹: 四张相同点数; 王炸: 大王+小王
【比较】
- 同牌型比主牌大小; 顺子/连对/飞机的长度必须相同才能压
- 炸弹可压任何非炸弹牌型; 王炸最大, 炸弹也压不了
- 三带一/三带二/飞机带翅膀: 只比较三张部分的大小, 翅膀不影响
【流程】
- 先手(台面上没有牌)时你必须出牌, 不能 pass
- 跟牌时可以出更大的牌压过, 也可以 pass
- 你是农民时:
  * 绝对不要压搭档(另一名农民)出的牌, 让搭档顺利跑牌
  * 轮到你去压地主的牌时, 要主动用合理的大牌压制, 帮搭档创造机会
- 你是地主时, 尽量压制农民
【策略】
- 目标是尽快出完手牌
- 保留炸弹/王炸用于关键压制, 不要轻易拆散
- 先手时优先出小牌和完整结构, 保留大牌控场
【农民协作原则】
- 搭档掌握牌权连续出牌时, 你应保留实力, 严禁用大牌或炸弹截断搭档
- 例外: 如果你手牌所剩无几、有把握一口气全部出完 (例如只剩一手能直接出完的牌), 可以打断搭档抢先出牌, 直接争取获胜
- 地主出牌且搭档未压时, 说明搭档可能难以应对, 此时你必须尽力用刚好够大的牌封堵地主, 必要时不惜使用炸弹扭转局面
- 手中保留能助攻的牌型: 比如拆对子给搭档喂单张, 或拆三张送搭档过渡, 优先帮助搭档先走
- 观察搭档出牌信号:
  * 搭档反复出单张 -> 可能单牌多, 你可用对子或三带帮其消耗牌权
  * 搭档出大牌压制后突然改出小牌 -> 可能想让你接手, 若你能控场应果断接下
  * 搭档主动出小牌且未明显压制地主 -> 可能是示弱求援, 你需做好接应准备`;

/**
 * 显示名: 自己始终为"你"; 其他玩家若名字是"你"(人类玩家占位名) 则用 玩家+座位 代替,
 * 避免 prompt 中多个"你"指代不同人造成模型思维链混乱。
 */
function displayName(req: { seat: number; players: AiPlayerInfo[] }, i: number): string {
  if (i === req.seat) return '你';
  const n = req.players[i]?.name;
  return n && n !== '你' ? n : `玩家${i}`;
}

function seatLabel(me: number, other: number, landlord: number | null): string {
  if (other === me) return '你';
  const role = landlord === null ? '' : landlord === other ? '(地主)' : '(农民)';
  if (landlord === null) return `座位${other}${role}`;
  const isPartner = landlord !== null && landlord !== me && landlord !== other;
  const relation = isPartner ? '你的搭档' : landlord === me ? '你的对手' : other === landlord ? '你的对手(地主)' : '你的搭档';
  return `${relation} 座位${other}${role}`;
}

function buildBidMessages(req: AiBidRequest): ChatMessage[] {
  const nameOf = (i: number) => displayName(req, i);
  const names = req.players.map((_, i) => `${displayName(req, i)}(座位${i})`);
  const lines: string[] = [
    `当前局面:`,
    `- 你: 座位${req.seat}, 手牌(${req.hand.length}张): ${handText(cardsFromTokens(req.hand))}`,
    `- 玩家: ${names.join(', ')}`,
    `- 叫地主顺序: ${req.bidOrder.map(i => nameOf(i)).join(' -> ')}`,
    `- 你是第 ${req.bidPosition + 1} 个叫地主的人`,
  ];
  const prev = req.previousBids.filter(b => b !== null);
  if (prev.length > 0) {
    lines.push(`- 前面已决定: ${req.bidOrder.slice(0, prev.length).map((i, k) => `${nameOf(i)} ${prev[k] ? '叫地主' : '不叫'}`).join('; ')}`);
  } else {
    lines.push(`- 前面还没有人决定 (你是第一个)`);
  }
  lines.push(`调用 decide_bid 工具给出你的决定。`);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
}

function buildPlayMessages(req: AiPlayRequest): ChatMessage[] {
  const me = req.players[req.seat];
  const landlord = req.players[req.landlordSeat];
  const lines: string[] = [
    `当前局面:`,
    `- 你: 座位${req.seat} (${req.seat === req.landlordSeat ? '地主' : '农民'}), 手牌(${me?.remaining ?? req.hand.length}张): ${handText(cardsFromTokens(req.hand))}`,
    `- 地主: ${displayName(req, req.landlordSeat)} (座位${req.landlordSeat}), 剩余 ${landlord?.remaining ?? '?'} 张`,
    `- 其他玩家: ${req.players
      .map((p, i) => (i === req.seat || i === req.landlordSeat ? null : `${displayName(req, i)}(座位${i}, 剩余${p.remaining}张)`))
      .filter(Boolean)
      .join(', ')}`,
  ];
  const nameOf = (i: number) => displayName(req, i);
  if (req.history && req.history.length > 0) {
    lines.push(`- 本局出牌记录 (共 ${req.history.length} 手):`);
    req.history.forEach((h, i) => {
      const shape = classify(cardsFromTokens(h.cards));
      const shapeText = shape ? ` (${HAND_NAMES[shape.name]})` : '';
      lines.push(`  ${i + 1}. ${nameOf(h.ownerSeat)}: [${h.cards.join(' ')}]${shapeText}`);
    });
    lines.push(`  你可以据此推断场上还剩下哪些牌 (包括其他玩家手中的牌)。`);
  }
  if (req.lastPlay) {
    const lastCards = cardsFromTokens(req.lastPlay.cards);
    const shape = classify(lastCards)!;
    const owner = req.lastPlay.ownerSeat;
    lines.push(
      `- 上家出的牌: [${req.lastPlay.cards.join(' ')}] (${HAND_NAMES[shape.name]}, 主牌${rankText(shape.mainRank)}) —— 由 ${owner === req.seat ? '你' : seatLabel(req.seat, owner, req.landlordSeat)} 所出`,
      `- 轮到你出牌 (跟牌)。`,
    );
    const hand = cardsFromTokens(req.hand);
    const options = getPlays(hand, shape);
    if (options.length > 0) {
      lines.push(`你的合法出牌选项(可以从中选择, 也可以选择手牌中其他合法组合):`);
      options.forEach((p, i) => {
        const s = classify(p)!;
        lines.push(`${i + 1}. [${p.map(cardToken).join(' ')}] (${HAND_NAMES[s.name]})`);
      });
    } else {
      lines.push(`你没有能压过当前牌型的牌, 只能 pass。`);
    }
  } else {
    lines.push(`- 台面上没有牌, 你是先手, 轮到你出牌。`, `- 你必须出牌, 不能 pass。`);
  }
  lines.push(`调用 play_cards 工具给出你的出牌决策。`);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
}

function cardsFromTokens(tokens: string[]): Card[] {
  return tokens.map((t, i) => ({
    id: `tok-${i}-${t}`,
    rank: parseRank(t),
    suit: parseSuit(t),
  }));
}

function parseRank(token: string): number {
  const m = token.match(/^(3|4|5|6|7|8|9|10|J|Q|K|A|2|SJ|BJ)/);
  if (!m) return 0;
  const t = m[1];
  if (t === 'SJ') return 16;
  if (t === 'BJ') return 17;
  return { J: 11, Q: 12, K: 13, A: 14, 2: 15 }[t] ?? Number(t);
}

function parseSuit(token: string): Card['suit'] {
  if (token.startsWith('SJ') || token.startsWith('BJ')) return null;
  return (token.slice(-1) as Card['suit']);
}

function rankText(rank: number): string {
  if (rank === 16) return '小王';
  if (rank === 17) return '大王';
  return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' }[rank] ?? String(rank);
}

interface ChatResult {
  /** 模型返回的 assistant 消息 (无工具调用时 args 为 null) */
  assistantMsg: ChatMessage;
  args: Record<string, unknown> | null;
  /** thinking 模型的思考过程 (message.reasoning_content) */
  reasoning?: string;
}

/** 从文本中提取 JSON 对象 (部分模型把决策直接写在正文里) */
function extractJsonFromText(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

async function chatOnce(
  config: Required<AiConfig>,
  messages: ChatMessage[],
  tool: ToolDef,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const base = config.baseUrl.replace(/\/+$/, '');
  const startedAt = Date.now();
  console.log(`[ai] ${tool.function.name} 开始请求模型 ${config.model}`);
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: [tool],
      // 'auto' 兼容性最好 (部分网关/thinking 模式不支持 'required')
      tool_choice: 'auto',
      temperature: 0.8,
      // OpenAI 兼容推理模型默认使用高思考强度
      reasoning_effort: 'high',
      // thinking 模式会消耗大量 token 在推理上，保留充足预算避免工具调用被截断
      max_tokens: MAX_DECISION_TOKENS,
    }),
    signal,
  });
  console.log(`[ai] ${tool.function.name} 模型响应耗时 ${Date.now() - startedAt}ms`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[ai] ${tool.function.name} 请求失败 ${res.status}: ${body.slice(0, 300)}`);
    throw new AiError(`AI API 请求失败 (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  const reasoning = extractReasoning(msg);
  const call = msg?.tool_calls?.[0];
  if (!call?.function?.arguments) {
    // 模型未通过工具返回参数: 尝试从正文中提取 JSON (部分 thinking 模型把决策写在正文里)
    const contentArgs = extractJsonFromText(String(msg?.content ?? ''));
    if (contentArgs) {
      console.warn(`[ai] ${tool.function.name} 未返回工具调用, 已从正文提取 JSON 参数`);
      return { assistantMsg: msg ?? { role: 'assistant', content: null }, args: contentArgs, reasoning };
    }
    console.warn(`[ai] ${tool.function.name} 未返回工具调用, content=${String(msg?.content ?? '').slice(0, 120)}`);
    return { assistantMsg: msg ?? { role: 'assistant', content: null }, args: null, reasoning };
  }
  let args: Record<string, unknown> | null;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    // 宽松解析: thinking 模型可能在 arguments 里夹带代码围栏/多余文本
    const m = String(call.function.arguments).match(/\{[\s\S]*\}/);
    try {
      args = m ? JSON.parse(m[0]) : null;
    } catch {
      args = null;
    }
    if (args === null)
      console.warn(`[ai] ${tool.function.name} 工具参数非 JSON: ${String(call.function.arguments).slice(0, 300)}`);
  }
  return { assistantMsg: msg, args, reasoning };
}

/** 提取 thinking 模型的思考过程 (DeepSeek 风格的 message.reasoning_content) */
function extractReasoning(msg: Record<string, unknown> | undefined): string | undefined {
  const r = (msg as { reasoning_content?: unknown } | undefined)?.reasoning_content;
  return typeof r === 'string' && r.length > 0 ? r : undefined;
}

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * 循环调用 LLM 工具直到返回合法决策: 每次失败把错误反馈给模型重新调用
 * (最多 maxAttempts 次), 不提供任何规则兜底。
 * 模型未调用工具时, 用用户消息要求其必须调用工具。
 */
async function decideWithRetry<T>(
  config: Required<AiConfig>,
  messages: ChatMessage[],
  tool: ToolDef,
  validate: (args: Record<string, unknown>) => Validation<T>,
  maxAttempts = 3,
  signal?: AbortSignal,
): Promise<{ value: T; attempts: number; reasoning?: string }> {
  const history = [...messages];
  const failures: string[] = [];
  const timeoutMs = decisionTimeoutMs();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const decisionSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { assistantMsg, args, reasoning } = await chatOnce(config, history, tool, decisionSignal);
      const toolCalls = (assistantMsg.tool_calls as { id: string }[] | undefined) ?? [];
      if (args === null) {
        history.push(assistantMsg);
        if (toolCalls.length > 0) {
          // 模型调用了工具但参数不是合法 JSON: API 要求 assistant(tool_calls) 后必须跟 tool 消息回应
          failures.push('工具参数不是合法 JSON');
          for (const tc of toolCalls) {
            history.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: `你的工具参数无效 (不是合法 JSON), 请重新调用 ${tool.function.name} 工具给出合法参数。`,
            });
          }
        } else {
          // 模型没有调用工具 (纯文本回答): 用用户消息要求必须调用工具
          failures.push('模型未调用工具');
          history.push({
            role: 'user',
            content: `你没有调用工具。你必须调用 ${tool.function.name} 工具给出决策, 不要用文字回答。`,
          });
        }
        continue;
      }
      const result = validate(args);
      if (result.ok) {
        console.log(`[ai] ${new Date().toISOString().slice(11, 19)} ${tool.function.name} 第 ${attempt + 1} 次调用成功`);
        return { value: result.value, attempts: attempt + 1, reasoning };
      }
      failures.push(result.error);
      console.warn(`[ai] ${new Date().toISOString().slice(11, 19)} ${tool.function.name} 决策无效: ${result.error}`);
      history.push(assistantMsg);
      if (toolCalls.length > 0) {
        for (let k = 0; k < toolCalls.length; k++) {
          history.push({
            role: 'tool',
            tool_call_id: toolCalls[k].id,
            content: k === 0 ? `你的决策无效: ${result.error}。请根据规则重新调用工具给出合法决策。` : '此工具调用已被忽略。',
          });
        }
      } else {
        // 参数来自正文提取 (无 tool_calls 可回应): 只能用用户消息反馈
        history.push({
          role: 'user',
          content: `你的决策无效: ${result.error}。请重新调用 ${tool.function.name} 工具给出合法决策, 不要用文字回答。`,
        });
      }
    }
  } catch (error) {
    if (timeoutSignal.aborted && !signal?.aborted)
      throw new AiError(`AI 思考超时 (${Math.ceil(timeoutMs / 1000)} 秒)，请重试或检查模型服务`);
    throw error;
  }
  throw new AiError(`AI 连续 ${maxAttempts} 次给出无效决策, 已放弃本次行动 (${failures.join(' | ')})`);
}

function resolveConfig(req: { config?: AiConfig }): Required<AiConfig> {
  const baseUrl = req.config?.baseUrl?.trim() ?? '';
  const apiKey = req.config?.apiKey ?? '';
  const model = req.config?.model?.trim() ?? '';
  return { baseUrl, apiKey, model };
}

function requireConfig(config: Required<AiConfig>): void {
  if (!config.baseUrl || !config.apiKey || !config.model)
    throw new AiError('未配置 AI 接口，请在 AI 设置中完整填写 Base URL、API Key 和模型');
}

export async function decideBid(req: AiBidRequest, signal?: AbortSignal): Promise<AiDecision> {
  const config = resolveConfig(req);
  requireConfig(config);
  const { value, attempts, reasoning } = await decideWithRetry(
    config,
    buildBidMessages(req),
    BID_TOOL,
    args => {
      const action = args.action;
      if (action !== 'call' && action !== 'pass')
        return { ok: false, error: `action 必须是 "call" 或 "pass", 收到 "${action}"` };
      return { ok: true, value: { call: action === 'call', reason: String(args.reason ?? '') } };
    },
    3,
    signal,
  );
  return {
    action: value.call ? 'call' : 'pass',
    cards: [],
    reason: value.reason || undefined,
    reasoning,
    attempts,
  };
}

interface PlayValue {
  action: 'play' | 'pass';
  cards: string[];
  shapeName?: string;
  reason: string;
}

export async function decidePlay(req: AiPlayRequest, signal?: AbortSignal): Promise<AiDecision> {
  const config = resolveConfig(req);
  requireConfig(config);
  const hand = cardsFromTokens(req.hand);
  const lastShape = req.lastPlay ? classify(cardsFromTokens(req.lastPlay.cards)) : null;

  const { value, attempts, reasoning } = await decideWithRetry<PlayValue>(
    config,
    buildPlayMessages(req),
    PLAY_TOOL,
    (args): Validation<PlayValue> => {
      const action = args.action;
      if (action !== 'play' && action !== 'pass')
        return { ok: false, error: `action 必须是 "play" 或 "pass", 收到 "${action}"` };
      if (action === 'pass') {
        if (req.lastPlay === null)
          return { ok: false, error: '你是先手, 台面上没有牌, 必须出牌, 不能 pass' };
        return { ok: true, value: { action: 'pass' as const, cards: [] as string[], shapeName: undefined, reason: String(args.reason ?? '') } };
      }
      const raw = args.cards;
      if (!Array.isArray(raw) || raw.length === 0)
        return { ok: false, error: 'action 为 play 时 cards 必须是非空数组' };
      const picked: Card[] = [];
      const seen = new Set<string>();
      for (const t of raw) {
        if (typeof t !== 'string') return { ok: false, error: `卡片编码 "${String(t)}" 无效` };
        const card = tokenToCard(t, hand);
        if (!card) return { ok: false, error: `卡片 "${t}" 不在你的手牌中` };
        if (seen.has(card.id)) return { ok: false, error: `卡片 "${t}" 重复出现` };
        seen.add(card.id);
        picked.push(card);
      }
      const shape = classify(picked);
      if (!shape)
        return { ok: false, error: `[${picked.map(cardLabel).join(' ')}] 不是合法牌型` };
      if (lastShape) {
        if (!canBeat(shape, lastShape))
          return {
            ok: false,
            error: `[${picked.map(cardLabel).join(' ')}] (${HAND_NAMES[shape.name]}) 压不过上家的 ${HAND_NAMES[lastShape.name]}`,
          };
      }
      return {
        ok: true,
        value: {
          action: 'play' as const,
          cards: picked.map(cardToken),
          shapeName: HAND_NAMES[shape.name],
          reason: String(args.reason ?? ''),
        },
      };
    },
    3,
    signal,
  );
  return { ...value, reason: value.reason || undefined, reasoning, attempts };
}
