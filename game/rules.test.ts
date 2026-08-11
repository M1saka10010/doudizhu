import { describe, expect, it } from 'vitest';
import type { Card, GameState, PlayAction } from './types';
import { canBeat, classify, getPlays, smallestBeatingPlay, bestLeadPlay } from './rules';
import { deal, startBidding, applyBid, applyAction, sortHand, createDeck } from './engine';

function mk(rank: number, suit: 'S' | 'H' | 'C' | 'D' | null = 'S', n = 0): Card {
  return { id: `${rank}${suit ?? 'J'}-${n}`, rank, suit };
}

const c = (rank: number, suit: 'S' | 'H' | 'C' | 'D' | null = 'S', n = 0) => mk(rank, suit, n);
const cards = (...ranks: number[]) => ranks.map((r, i) => c(r, 'S', i));

describe('classify 牌型识别', () => {
  it('基础牌型', () => {
    expect(classify(cards(3))).toEqual({ name: 'single', mainRank: 3, size: 1 });
    expect(classify(cards(3, 3))).toEqual({ name: 'pair', mainRank: 3, size: 2 });
    expect(classify(cards(3, 3, 3))).toEqual({ name: 'triple', mainRank: 3, size: 3 });
    expect(classify(cards(3, 3, 3, 3))).toEqual({ name: 'bomb', mainRank: 3, size: 4 });
    expect(classify([c(16, null), c(17, null)])).toEqual({ name: 'rocket', mainRank: 17, size: 2 });
    expect(classify(cards(3, 3, 3, 4))).toEqual({ name: 'tripleWithSingle', mainRank: 3, size: 4 });
    expect(classify(cards(3, 3, 3, 4, 4))).toEqual({ name: 'tripleWithPair', mainRank: 3, size: 5 });
  });

  it('顺子 / 连对 / 飞机', () => {
    expect(classify(cards(3, 4, 5, 6, 7))).toEqual({ name: 'straight', mainRank: 7, size: 5 });
    expect(classify(cards(3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14))).toEqual({
      name: 'straight', mainRank: 14, size: 12,
    });
    expect(classify(cards(3, 3, 4, 4, 5, 5))).toEqual({ name: 'pairChain', mainRank: 5, size: 6 });
    expect(classify(cards(3, 3, 3, 4, 4, 4))).toEqual({ name: 'airplane', mainRank: 4, size: 6 });
    expect(classify(cards(3, 3, 3, 4, 4, 4, 5, 5, 6, 6))).toEqual({ name: 'airplaneWithPairs', mainRank: 4, size: 10 });
    expect(classify(cards(3, 3, 3, 4, 4, 4, 6, 7))).toEqual({ name: 'airplaneWithSingles', mainRank: 4, size: 8 });
    // 三张可从四张中取: 33334444 = 飞机带单 (333 444 + 3 4)
    expect(classify([c(3, 'S'), c(3, 'H'), c(3, 'C'), c(3, 'D'), c(4, 'S'), c(4, 'H'), c(4, 'C'), c(4, 'D')]))
      .toEqual({ name: 'airplaneWithSingles', mainRank: 4, size: 8 });
  });

  it('四带二 / 四带两对', () => {
    expect(classify(cards(3, 3, 3, 3, 4, 5))).toEqual({ name: 'fourWithTwo', mainRank: 3, size: 6 });
    expect(classify(cards(3, 3, 3, 3, 4, 4))).toEqual({ name: 'fourWithTwo', mainRank: 3, size: 6 });
    expect(classify(cards(3, 3, 3, 3, 4, 4, 5, 5))).toEqual({ name: 'fourWithTwoPairs', mainRank: 3, size: 8 });
  });

  it('非法组合', () => {
    expect(classify(cards(3, 4))).toBeNull();
    expect(classify(cards(3, 3, 4))).toBeNull();
    expect(classify(cards(3, 3, 4, 4))).toBeNull();
    expect(classify(cards(3, 3, 3, 4, 5))).toBeNull();
    expect(classify(cards(3, 3, 3, 4, 4, 5))).toBeNull();
    expect(classify(cards(3, 3, 4, 5))).toBeNull();
    // 顺子不能含 2 / 王
    expect(classify(cards(10, 11, 12, 13, 14, 15))).toBeNull();
    expect(classify([c(10), c(11), c(12), c(13), c(16, null)])).toBeNull();
    // 顺子不能断
    expect(classify(cards(3, 4, 5, 6, 8))).toBeNull();
    // 四带二不能带两张散牌以外的形态 (8 张必须是两对)
    expect(classify(cards(3, 3, 3, 3, 4, 5, 6, 7))).toBeNull();
    // 三带二不能带两张不同单牌
    expect(classify(cards(3, 3, 3, 4, 5))).toBeNull();
    expect(classify([])).toBeNull();
  });
});

describe('canBeat 比较', () => {
  it('同型比大小', () => {
    expect(canBeat({ name: 'single', mainRank: 5, size: 1 }, { name: 'single', mainRank: 3, size: 1 })).toBe(true);
    expect(canBeat({ name: 'single', mainRank: 3, size: 1 }, { name: 'single', mainRank: 5, size: 1 })).toBe(false);
    expect(canBeat({ name: 'bomb', mainRank: 10, size: 4 }, { name: 'bomb', mainRank: 5, size: 4 })).toBe(true);
    expect(canBeat({ name: 'rocket', mainRank: 17, size: 2 }, { name: 'rocket', mainRank: 17, size: 2 })).toBe(false);
  });

  it('异型不能互压 (除炸弹/王炸)', () => {
    expect(canBeat({ name: 'pair', mainRank: 14, size: 2 }, { name: 'single', mainRank: 3, size: 1 })).toBe(false);
    expect(canBeat({ name: 'straight', mainRank: 8, size: 6 }, { name: 'straight', mainRank: 9, size: 5 })).toBe(false);
    expect(canBeat({ name: 'tripleWithSingle', mainRank: 10, size: 4 }, { name: 'tripleWithPair', mainRank: 3, size: 5 })).toBe(false);
  });

  it('炸弹/王炸压制一切', () => {
    expect(canBeat({ name: 'bomb', mainRank: 3, size: 4 }, { name: 'rocket', mainRank: 17, size: 2 })).toBe(false);
    expect(canBeat({ name: 'rocket', mainRank: 17, size: 2 }, { name: 'bomb', mainRank: 15, size: 4 })).toBe(true);
    expect(canBeat({ name: 'rocket', mainRank: 17, size: 2 }, { name: 'straight', mainRank: 14, size: 5 })).toBe(true);
  });
});

describe('getPlays 出牌生成', () => {
  it('先手时生成所有合法牌型 (含关键组合)', () => {
    const hand = [...cards(3, 3, 3, 4, 4, 5, 6, 7, 8, 9), c(15, 'S'), c(15, 'H'), c(16, null), c(17, null)];
    const plays = getPlays(hand, null);
    expect(plays.length).toBeGreaterThan(0);
    const shapes = plays.map(p => classify(p)!);
    for (const s of shapes) expect(s).not.toBeNull();
    const keys = shapes.map(s => `${s.name}:${s.mainRank}`);
    // 关键组合存在: 单张、对子、三张、三带一、三带二、顺子、对 2、王炸
    expect(keys).toContain('single:3');
    expect(keys).toContain('pair:3');
    expect(keys).toContain('triple:3');
    expect(keys).toContain('tripleWithSingle:3');
    expect(keys).toContain('tripleWithPair:3');
    expect(keys).toContain('straight:9');
    expect(keys).toContain('pair:15');
    expect(keys).toContain('rocket:17');
    // 三带一的翅膀可以用任意单牌
    const wings = plays.filter(p => {
      const s = classify(p)!;
      return s.name === 'tripleWithSingle' && s.mainRank === 3;
    });
    expect(wings.length).toBe(11); // 手牌除 3 张 3 外还有 11 张可带
    // 全部合法
    for (const p of plays) expect(classify(p)).not.toBeNull();
  });

  it('跟单张: 只生成更大的单张 + 炸弹/王炸', () => {
    const hand = [...cards(3, 4, 5, 5, 9), c(15, 'S'), c(16, null), c(17, null)];
    const plays = getPlays(hand, { name: 'single', mainRank: 7, size: 1 });
    expect(plays.length).toBe(5); // 9, 2, SJ, BJ, 王炸? 王炸是两张: 9/2/SJ/BJ 单张 + 王炸
    for (const p of plays) {
      const s = classify(p)!;
      expect(canBeat(s, { name: 'single', mainRank: 7, size: 1 })).toBe(true);
    }
  });

  it('跟顺子: 长度必须相同', () => {
    const hand = [...cards(4, 5, 6, 7, 8), c(3, 'S', 9), c(3, 'H', 9), c(3, 'C', 9), c(3, 'D', 9)];
    const plays = getPlays(hand, { name: 'straight', mainRank: 7, size: 5 });
    const straights = plays.map(classify).filter(s => s!.name === 'straight');
    expect(straights.every(s => s!.size === 5 && s!.mainRank > 7)).toBe(true);
    // [3..7] 与上家平局不能压, 只有 [4..8]
    expect(straights.map(s => s!.mainRank).sort()).toEqual([8]);
    // 炸弹也在选项中
    expect(plays.some(p => classify(p)!.name === 'bomb')).toBe(true);
  });

  it('压三带一: 主牌更大即可, 带的单可任意', () => {
    const hand = [...cards(9, 9, 9, 10), ...cards(3, 3, 3, 5, 5, 5, 7)];
    const plays = getPlays(hand, { name: 'tripleWithSingle', mainRank: 5, size: 4 });
    const shapes = plays.map(classify);
    expect(shapes.every(s => s!.name === 'tripleWithSingle' && s!.mainRank > 5)).toBe(true);
    // 9 的三带一可以用任意单牌
    expect(plays.some(p => p.some(x => x.rank === 9) && p.some(x => x.rank === 10))).toBe(true);
    expect(plays.some(p => p.some(x => x.rank === 9) && p.some(x => x.rank === 7))).toBe(true);
  });

  it('王炸之后无解; 无压制时只生成炸弹', () => {
    const hand = [...cards(3, 4, 5), c(3, 'S', 9), c(3, 'H', 9), c(3, 'C', 9)];
    expect(getPlays(hand, { name: 'rocket', mainRank: 17, size: 2 })).toEqual([]);
    const plays = getPlays(hand, { name: 'pair', mainRank: 15, size: 2 });
    expect(plays.every(p => classify(p)!.name === 'bomb')).toBe(true);
  });

  it('跟炸弹时只生成更大的炸弹或王炸', () => {
    const hand = [
      ...cards(3, 3, 3, 3),
      c(11, 'S', 10), c(11, 'H', 11), c(11, 'C', 12), c(11, 'D', 13),
      c(16, null, 14), c(17, null, 15),
    ];
    const last = { name: 'bomb' as const, mainRank: 10, size: 4 };
    const plays = getPlays(hand, last);
    const shapes = plays.map(p => classify(p)!);
    expect(shapes.some(s => s.name === 'bomb' && s.mainRank === 3)).toBe(false);
    expect(shapes.some(s => s.name === 'bomb' && s.mainRank === 11)).toBe(true);
    expect(shapes.some(s => s.name === 'rocket')).toBe(true);
    expect(shapes.every(s => canBeat(s, last))).toBe(true);
  });

  it('跟四带二/四带两对时不生成更小的同型组合', () => {
    const hand = [
      c(3, 'S', 0), c(3, 'H', 1), c(3, 'C', 2), c(3, 'D', 3),
      c(4, 'S', 4), c(5, 'S', 5), c(6, 'S', 6), c(6, 'H', 7), c(7, 'S', 8), c(7, 'H', 9),
    ];
    const fourWithTwo = { name: 'fourWithTwo' as const, mainRank: 5, size: 6 };
    const fourWithPairs = { name: 'fourWithTwoPairs' as const, mainRank: 5, size: 8 };
    expect(getPlays(hand, fourWithTwo).every(p => canBeat(classify(p)!, fourWithTwo))).toBe(true);
    expect(getPlays(hand, fourWithTwo).some(p => classify(p)!.name === 'fourWithTwo')).toBe(false);
    expect(getPlays(hand, fourWithPairs).every(p => canBeat(classify(p)!, fourWithPairs))).toBe(true);
    expect(getPlays(hand, fourWithPairs).some(p => classify(p)!.name === 'fourWithTwoPairs')).toBe(false);
  });

  it('飞机带单的翅膀选择合法', () => {
    const hand = [...cards(3, 3, 3, 4, 4, 4), ...cards(5, 6, 9, 9, 9)];
    const plays = getPlays(hand, null);
    for (const p of plays) expect(classify(p)).not.toBeNull();
  });
});

describe('策略辅助函数', () => {
  it('smallestBeatingPlay 返回最小压制; 无解返回 null', () => {
    const hand = [...cards(3, 4, 5, 5, 9), c(15, 'S')];
    expect(smallestBeatingPlay(hand, { name: 'single', mainRank: 7, size: 1 })).toEqual([c(9, 'S', 4)]);
    expect(smallestBeatingPlay(hand, { name: 'single', mainRank: 15, size: 1 })).toBeNull();
    // 只剩炸弹也能压
    const bombOnly = cards(3, 3, 3, 3);
    expect(smallestBeatingPlay(bombOnly, { name: 'single', mainRank: 15, size: 1 })).not.toBeNull();
  });

  it('bestLeadPlay 优先出大结构', () => {
    const hand = [...cards(3, 3, 3, 4, 5, 6, 7)];
    const play = bestLeadPlay(hand)!;
    expect(play.length).toBe(5); // 顺子优先于三张/单张
    expect(classify(play)!.name).toBe('straight');
  });
});

/** 确定性伪随机数 (mulberry32) */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('engine 发牌与叫地主', () => {
  it('发牌: 54 张不重复, 每人 17 张, 底牌 3 张', () => {
    const deck = createDeck();
    expect(deck.length).toBe(54);
    expect(new Set(deck.map(x => x.id)).size).toBe(54);
    for (let i = 0; i < 20; i++) {
      const { hands, bottom } = deal(mulberry32(i));
      expect(hands.map(h => h.length)).toEqual([17, 17, 17]);
      expect(bottom.length).toBe(3);
      const all = [...hands.flat(), ...bottom];
      expect(new Set(all.map(x => x.id)).size).toBe(54);
    }
  });

  it('叫地主流程: 按顺序推进, 第一个叫的当地主并收底牌', () => {
    const rng = mulberry32(7);
    const { hands, bottom } = deal(rng);
    const state: GameState = {
      phase: 'bidding',
      players: hands.map((h, i) => ({
        name: `P${i}`,
        isAI: true,
        hand: sortHand(h),
        played: null,
        passed: false,
        bid: null,
      })),
      landlord: null,
      bottom,
      turn: 0,
      lastPlay: null,
      passes: 0,
      winner: null,
      bidding: startBidding(rng),
      history: [],
    };

    // 顺序第一家的决定被记录
    let s = applyBid(state, state.bidding!.order[0], false);
    expect(s.phase).toBe('bidding');
    expect(s.bidding!.step).toBe(1);
    expect(s.players[s.bidding!.order[0]].bid).toBe(false);

    // 第二家叫 → 成为地主, 收底牌, 进入出牌阶段, 轮到地主
    s = applyBid(s, s.bidding!.order[1], true);
    expect(s.phase).toBe('playing');
    const landlord = s.landlord!;
    expect(landlord).toBe(s.bidding!.order[1]);
    expect(s.players[landlord].hand.length).toBe(20);
    expect(s.players[landlord].bid).toBe(true);
    expect(s.turn).toBe(landlord);
    expect(s.lastPlay).toBeNull();
  });

  it('叫地主流程: 前两家不叫则第三家强制叫', () => {
    const rng = mulberry32(3);
    const { hands, bottom } = deal(rng);
    const base: GameState = {
      phase: 'bidding',
      players: hands.map((h, i) => ({
        name: `P${i}`, isAI: true, hand: sortHand(h), played: null, passed: false, bid: null,
      })),
      landlord: null,
      bottom,
      turn: 0,
      lastPlay: null,
      passes: 0,
      winner: null,
      bidding: startBidding(rng),
      history: [],
    };
    let s = applyBid(base, base.bidding!.order[0], false);
    s = applyBid(s, s.bidding!.order[1], false);
    expect(s.phase).toBe('bidding');
    // 第三家无论传什么决定都被强制为叫
    s = applyBid(s, s.bidding!.order[2], false);
    expect(s.phase).toBe('playing');
    const landlord = s.landlord!;
    expect(landlord).toBe(base.bidding!.order[2]);
    expect(s.players[landlord].bid).toBe(true);
    expect(s.players[landlord].hand.length).toBe(20);
  });

  it('叫地主流程: 乱序/重复叫会抛错', () => {
    const rng = mulberry32(3);
    const { hands, bottom } = deal(rng);
    const state: GameState = {
      phase: 'bidding',
      players: hands.map((h, i) => ({
        name: `P${i}`, isAI: true, hand: sortHand(h), played: null, passed: false, bid: null,
      })),
      landlord: null,
      bottom,
      turn: 0,
      lastPlay: null,
      passes: 0,
      winner: null,
      bidding: startBidding(rng),
      history: [],
    };
    const first = state.bidding!.order[0];
    const second = state.bidding!.order[1];
    expect(() => applyBid(state, second, true)).toThrow(); // 跳序
    const s1 = applyBid(state, first, true);
    expect(() => applyBid(s1, first, false)).toThrow(); // 已叫过, 已进 playing
    expect(() => applyBid(s1, second, false)).toThrow();
  });

  it('完整对局模拟: 对局必然终止且有赢家, 所有动作合法', () => {
    for (let seed = 0; seed < 30; seed++) {
      const rng = mulberry32(seed);
      const { hands, bottom } = deal(rng);
      const names = ['你', 'AI·小南', 'AI·小北'];
      const players = hands.map((h, i) => ({
        name: names[i],
        isAI: i !== 0,
        hand: sortHand(h),
        played: null as Card[] | null,
        passed: false,
        bid: null as boolean | null,
      }));
      let state: GameState = {
        phase: 'bidding',
        players,
        landlord: null,
        bottom,
        turn: 0,
        lastPlay: null,
        passes: 0,
        winner: null,
        bidding: startBidding(rng),
      history: [],
      };
      // 测试替身: 有炸弹/王炸就叫, 否则不叫; 最后一家强制
      for (let s = 0; s < 3 && state.phase === 'bidding'; s++) {
        const seat = state.bidding!.order[state.bidding!.step];
        const hand = state.players[seat].hand;
        const hasBig = hand.some(c => c.rank >= 16) || hand.filter(c => c.rank === 15).length >= 2;
        state = applyBid(state, seat, hasBig);
      }
      expect(state.phase).toBe('playing');

      let steps = 0;
      let playedTotal = 0;
      let playedHands = 0;
      while (state.phase !== 'ended' && steps < 1000) {
        steps++;
        const p = state.players[state.turn];
        let action: PlayAction;
        if (state.lastPlay === null) {
          const lead = bestLeadPlay(p.hand)!;
          action = { type: 'play', cards: lead };
        } else {
          const beat = smallestBeatingPlay(p.hand, state.lastPlay.shape);
          action = beat ? { type: 'play', cards: beat } : { type: 'pass' };
        }
        state = applyAction(state, state.turn, action);
        if (action.type === 'play') {
          playedTotal += action.cards.length;
          playedHands++;
        }
        // 每手出牌都被记录
        expect(state.history.length).toBe(playedHands);
        // 手牌 + 已出牌总数守恒
        const inHand = state.players.reduce((s, pl) => s + pl.hand.length, 0);
        expect(inHand + playedTotal).toBe(54);
      }
      expect(state.phase).toBe('ended');
      expect(state.winner).not.toBeNull();
      // 最后记录的手数与实际出牌手数一致
      expect(state.history.length).toBe(playedHands);
    }
  });

  it('出牌状态机拒绝错误阶段、错误回合和越界座位', () => {
    const rng = mulberry32(12);
    const { hands, bottom } = deal(rng);
    const players = hands.map((h, i) => ({
      name: `P${i}`, isAI: true, hand: sortHand(h), played: null as Card[] | null,
      passed: false, bid: null as boolean | null,
    }));
    const bidding: GameState = {
      phase: 'bidding', players, landlord: null, bottom, turn: 0, lastPlay: null,
      passes: 0, winner: null, bidding: startBidding(rng), history: [],
    };
    const first = bidding.bidding!.order[0];
    const playing = applyBid(bidding, first, true);
    const lead = [playing.players[playing.turn].hand[0]];
    expect(() => applyAction(bidding, first, { type: 'play', cards: lead })).toThrow('当前不在出牌阶段');
    expect(() => applyAction(playing, (playing.turn + 1) % 3, { type: 'pass' })).toThrow('还没轮到');
    expect(() => applyAction(playing, -1, { type: 'pass' })).toThrow('座位无效');
  });

  it('出牌状态机拒绝伪造、篡改和重复使用的牌', () => {
    const rng = mulberry32(18);
    const { hands, bottom } = deal(rng);
    const players = hands.map((h, i) => ({
      name: `P${i}`, isAI: true, hand: sortHand(h), played: null as Card[] | null,
      passed: false, bid: null as boolean | null,
    }));
    const bidding: GameState = {
      phase: 'bidding', players, landlord: null, bottom, turn: 0, lastPlay: null,
      passes: 0, winner: null, bidding: startBidding(rng), history: [],
    };
    const playing = applyBid(bidding, bidding.bidding!.order[0], true);
    const seat = playing.turn;
    const actual = playing.players[seat].hand[0];
    const fake: Card = { id: 'not-in-hand', rank: actual.rank, suit: actual.suit };
    const tampered: Card = { ...actual, rank: actual.rank === 17 ? 3 : actual.rank + 1 };
    expect(() => applyAction(playing, seat, { type: 'play', cards: [fake] })).toThrow('不在该玩家手牌中');
    expect(() => applyAction(playing, seat, { type: 'play', cards: [tampered] })).toThrow('卡牌信息');
    expect(() => applyAction(playing, seat, { type: 'play', cards: [actual, actual] })).toThrow('重复使用');
  });
});
