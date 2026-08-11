import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AiError, decideBid, decidePlay, setDecisionTimeoutForTesting } from './decision';
import { deal, sortHand } from '../../game/engine';
import { cardToken } from '../../game/cards';

/** 简易 OpenAI 兼容 mock 服务器: 按请求内容返回 tool_calls 响应 */
function mockOpenAI(
  handler: (body: {
    messages: Record<string, unknown>[];
    model: string;
    tools: unknown[];
    reasoning_effort?: string;
    max_tokens?: number;
  }) => Record<string, unknown>,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const result = handler(parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  });
  return new Promise(resolve => {
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () => new Promise(r => server.close(() => r())),
      });
    });
  });
}

function toolResponse(callId: string, name: string, args: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: callId, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

let mock: { port: number; close: () => Promise<void> } | null = null;

beforeEach(async () => {
  mock = await mockOpenAI(() => ({}));
});
afterEach(async () => {
  setDecisionTimeoutForTesting();
  await mock!.close();
  mock = null;
});

function cfg() {
  return { baseUrl: `http://127.0.0.1:${mock!.port}/v1`, apiKey: 'test-key', model: 'test-model' };
}

const { hands } = deal(() => 0.42);
const hand = sortHand(hands[0]);
const tokens = hand.map(cardToken);

describe('decideBid 叫地主 tool call', () => {
  it('静态版只接受完整的浏览器配置且不会读取服务器环境变量', async () => {
    const previous = {
      baseUrl: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL,
    };
    process.env.OPENAI_BASE_URL = 'https://server.example/v1';
    process.env.OPENAI_API_KEY = 'server-secret';
    process.env.OPENAI_MODEL = 'server-model';
    try {
      await expect(decideBid({
        config: { baseUrl: 'https://attacker.example/v1', apiKey: '', model: 'attacker-model' },
        seat: 1,
        hand: tokens,
        bidOrder: [1, 2, 0],
        bidPosition: 0,
        previousBids: [null, null, null],
        players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }],
      })).rejects.toThrow('未配置 AI 接口');
    } finally {
      if (previous.baseUrl === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previous.baseUrl;
      if (previous.apiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous.apiKey;
      if (previous.model === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = previous.model;
    }
  });

  it('调用方取消时会中断正在等待的上游请求', async () => {
    let markArrived!: () => void;
    const arrived = new Promise<void>(resolve => { markArrived = resolve; });
    const server = createServer((_req, res) => {
      markArrived();
      res.on('close', () => undefined);
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    const controller = new AbortController();
    const pending = decideBid({
      config: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k', model: 'm' },
      seat: 1,
      hand: tokens,
      bidOrder: [1, 2, 0],
      bidPosition: 0,
      previousBids: [null, null, null],
      players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }],
    }, controller.signal);
    await arrived;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('整次决策超时后明确报错而不是一直等待', async () => {
    setDecisionTimeoutForTesting(40);
    const server = createServer((_req, res) => {
      res.on('close', () => undefined);
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(decideBid({
        config: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k', model: 'm' },
        seat: 1,
        hand: tokens,
        bidOrder: [1, 2, 0],
        bidPosition: 0,
        previousBids: [null, null, null],
        players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }],
      })).rejects.toThrow('AI 思考超时 (1 秒)');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('解析模型返回的叫地主决定', async () => {
    mock = await mockOpenAI(body => {
      expect(body.model).toBe('test-model');
      expect(body.tools).toHaveLength(1);
      expect(body.reasoning_effort).toBe('high');
      expect(body.max_tokens).toBe(128_000);
      expect((body.tools[0] as { function: { name: string } }).function.name).toBe('decide_bid');
      return toolResponse('call-1', 'decide_bid', { action: 'call', reason: '手牌有大王' });
    });
    const r = await decideBid({
      config: cfg(),
      seat: 1,
      hand: tokens,
      bidOrder: [1, 2, 0],
      bidPosition: 0,
      previousBids: [null, null, null],
      players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }],
    });
    expect(r.action).toBe('call');
    expect(r.reason).toBe('手牌有大王');
    expect(r.attempts).toBe(1);
  });

  it('透传 thinking 模型的思考内容 (reasoning_content)', async () => {
    mock = await mockOpenAI(() => ({
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          reasoning_content: '我手里有双王和一个炸弹, 牌力很强, 应该叫地主。',
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'decide_bid', arguments: JSON.stringify({ action: 'call', reason: '牌力强' }) } }],
        },
      }],
    }));
    const r = await decideBid({
      config: cfg(),
      seat: 1,
      hand: tokens,
      bidOrder: [1, 2, 0],
      bidPosition: 0,
      previousBids: [null, null, null],
      players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }],
    });
    expect(r.action).toBe('call');
    expect(r.reasoning).toContain('双王');
    // 无 reasoning_content 时字段缺省
    mock = await mockOpenAI(() => toolResponse('call-1', 'decide_bid', { action: 'pass' }));
    const r2 = await decideBid({
      config: cfg(),
      seat: 1,
      hand: tokens,
      bidOrder: [1, 2, 0],
      bidPosition: 0,
      previousBids: [null, null, null],
      players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }],
    });
    expect(r2.reasoning).toBeUndefined();
  });

  it('未配置接口时直接报错', async () => {
    await expect(
      decideBid({
        seat: 1,
        hand: tokens,
        bidOrder: [1, 2, 0],
        bidPosition: 0,
        previousBids: [null, null, null],
        players: [],      }),
    ).rejects.toThrow(AiError);
  });

  it('模型未调用工具时反馈并要求重新调用, 第二次成功', async () => {
    let calls = 0;
    let sawReminder = false;
    mock = await mockOpenAI(body => {
      calls++;
      const msgs = body.messages as { role: string; content?: string }[];
      if (msgs.some(m => m.role === 'user' && String(m.content).includes('你必须调用'))) sawReminder = true;
      if (calls === 1) {
        // 返回纯文本, 不调用工具
        return { choices: [{ message: { role: 'assistant', content: '我不调用工具' } }] };
      }
      return toolResponse('call-2', 'decide_bid', { action: 'pass', reason: '第二次才调用' });
    });
    const r = await decideBid({
      config: cfg(),
      seat: 1,
      hand: tokens,
      bidOrder: [1, 2, 0],
      bidPosition: 0,
      previousBids: [null, null, null],
      players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }],
    });
    expect(calls).toBe(2);
    expect(sawReminder).toBe(true);
    expect(r.action).toBe('pass');
    expect(r.attempts).toBe(2);
  });

  it('工具参数不是 JSON 时: 用 tool 消息回应 (API 要求 assistant(tool_calls) 后必须跟 tool 消息)', async () => {
    let calls = 0;
    let messageShapeOk = true;
    mock = await mockOpenAI(body => {
      calls++;
      const msgs = body.messages as { role: string; tool_call_id?: string; tool_calls?: unknown[] }[];
      if (calls === 2) {
        // 校验: 带 tool_calls 的 assistant 消息后必须紧跟 tool 消息, 不得出现 user 消息
        let lastAssistant = -1;
        for (let i = 0; i < msgs.length; i++) {
          if (msgs[i].role === 'assistant' && msgs[i].tool_calls) lastAssistant = i;
        }
        const after = msgs.slice(lastAssistant + 1);
        const firstAfter = after[0];
        messageShapeOk =
          firstAfter?.role === 'tool' && !!firstAfter.tool_call_id && !after.some(m => m.role === 'user');
      }
      if (calls === 1) {
        // 返回带 tool_calls 但参数不是合法 JSON
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call-bad', type: 'function', function: { name: 'decide_bid', arguments: '{不是json' } }],
            },
          }],
        };
      }
      return toolResponse('call-2', 'decide_bid', { action: 'call', reason: '第二次合法' });
    });
    const r = await decideBid({
      config: cfg(),
      seat: 1,
      hand: tokens,
      bidOrder: [1, 2, 0],
      bidPosition: 0,
      previousBids: [null, null, null],
      players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }],
    });
    expect(calls).toBe(2);
    expect(messageShapeOk).toBe(true);
    expect(r.action).toBe('call');
    expect(r.attempts).toBe(2);
  });

  it('模型不调用工具但把 JSON 写在正文里: 从正文提取并接受', async () => {
    mock = await mockOpenAI(() => ({
      choices: [{
        message: {
          role: 'assistant',
          content: '我决定叫地主。{"action": "call", "reason": "手牌有大王"}',
        },
      }],
    }));
    const r = await decideBid({
      config: cfg(),
      seat: 1,
      hand: tokens,
      bidOrder: [1, 2, 0],
      bidPosition: 0,
      previousBids: [null, null, null],
      players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }],
    });
    expect(r.action).toBe('call');
    expect(r.reason).toBe('手牌有大王');
    expect(r.attempts).toBe(1);
  });

  it('API 返回 500 时报 AiError', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        decideBid({
          config: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k', model: 'm' },
          seat: 1,
          hand: tokens,
          bidOrder: [1, 2, 0],
          bidPosition: 0,
          previousBids: [null, null, null],
          players: [],
        }),
      ).rejects.toThrow(AiError);
    } finally {
      server.close();
    }
  });
});

describe('decidePlay 出牌 tool call', () => {
  const lastPlay = { ownerSeat: 2, cards: [cardToken(hands[2][0])] };

  it('解析合法出牌', async () => {
    mock = await mockOpenAI(() =>
      toolResponse('call-1', 'play_cards', { action: 'play', cards: [tokens[0]], reason: '出最小的' }),
    );
    const r = await decidePlay({ config: cfg(), seat: 1, hand: tokens, lastPlay, landlordSeat: 0, players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }] });
    expect(r.action).toBe('play');
    expect(r.cards).toEqual([tokens[0]]);
    expect(r.shapeName).toBeDefined();
  });

  it('先手不能 pass: 非法决定会反馈错误并重试', async () => {
    let calls = 0;
    let sawFeedback = false;
    mock = await mockOpenAI(body => {
      calls++;
      const msgs = body.messages as { role: string; content?: string }[];
      if (msgs.some(m => m.role === 'tool' && String(m.content).includes('不能 pass'))) sawFeedback = true;
      return toolResponse(`call-${calls}`, 'play_cards', { action: 'pass', cards: [] });
    });
    // 先手 (lastPlay 为 null), 模型两次都返回 pass → 校验失败后重试仍失败
    await expect(decidePlay({ config: cfg(), seat: 1, hand: tokens, lastPlay: null, landlordSeat: 0, players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }] }))
      .rejects.toThrow(AiError);
    expect(calls).toBe(3);
    expect(sawFeedback).toBe(true);
  });

  it('非法牌型会反馈错误并重试, 第二次合法则接受', async () => {
    let calls = 0;
    let sawFeedback = false;
    mock = await mockOpenAI(body => {
      calls++;
      const msgs = body.messages as { role: string; content?: string }[];
      if (msgs.some(m => m.role === 'tool' && String(m.content).includes('不在你的手牌中'))) sawFeedback = true;
      if (calls === 1)
        return toolResponse('call-1', 'play_cards', { action: 'play', cards: ['XX', 'YY'] });
      return toolResponse('call-2', 'play_cards', { action: 'play', cards: [tokens[0]] });
    });
    const r = await decidePlay({ config: cfg(), seat: 1, hand: tokens, lastPlay, landlordSeat: 0, players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }] });
    expect(calls).toBe(2);
    expect(sawFeedback).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.action).toBe('play');
    expect(r.cards).toEqual([tokens[0]]);
  });

  it('压不过上家的牌会被拒绝', async () => {
    mock = await mockOpenAI(() => toolResponse('call-1', 'play_cards', { action: 'play', cards: [tokens[0]] }));
    // 上家出的是手牌中最大的单张 → tokens[0] 压不过它自己
    const ownLast = { ownerSeat: 2, cards: [tokens[0]] };
    await expect(
      decidePlay({ config: cfg(), seat: 1, hand: tokens, lastPlay: ownLast, landlordSeat: 0, players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }] }),
    ).rejects.toThrow(AiError);
  });

  it('跟牌时可以 pass', async () => {
    mock = await mockOpenAI(() => toolResponse('call-1', 'play_cards', { action: 'pass', cards: [] }));
    const r = await decidePlay({ config: cfg(), seat: 1, hand: tokens, lastPlay, landlordSeat: 0, players: [{ name: '你', remaining: 17 }, { name: 'A', remaining: 17 }, { name: 'B', remaining: 17 }] });
    expect(r.action).toBe('pass');
    expect(r.cards).toEqual([]);
  });
});
