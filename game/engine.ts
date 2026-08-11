import type { BiddingState, Card, GameState, PlayAction } from './types';
import { canBeat, classify } from './rules';

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let rank = 3; rank <= 15; rank++)
    for (const suit of ['S', 'H', 'C', 'D'] as const)
      deck.push({ id: `${rank}${suit}`, rank, suit });
  deck.push({ id: 'SJ', rank: 16, suit: null });
  deck.push({ id: 'BJ', rank: 17, suit: null });
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 随机发牌: 每人 17 张, 3 张底牌 */
export function deal(rng: () => number = Math.random): { hands: Card[][]; bottom: Card[] } {
  const deck = shuffle(createDeck(), rng);
  return {
    hands: [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)],
    bottom: deck.slice(51),
  };
}

const SUIT_ORDER: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };

/** 手牌排序: 从大到小 (大王..3), 同点数按花色 */
export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort(
    (a, b) =>
      b.rank - a.rank ||
      (a.suit ? SUIT_ORDER[a.suit] : 4) - (b.suit ? SUIT_ORDER[b.suit] : 4),
  );
}

/** 开始叫地主: 随机起点, 按顺序每家决定 (决策由 AI tool call / 用户手动给出) */
export function startBidding(rng: () => number = Math.random): BiddingState {
  const start = Math.floor(rng() * 3);
  return {
    order: [start, (start + 1) % 3, (start + 2) % 3],
    step: 0,
    decisions: [null, null, null],
    landlord: null,
  };
}

/**
 * 记录一家叫地主决定并推进流程。
 * 叫 → 成为地主, 收底牌, 进入出牌阶段; 不叫 → 下一家。
 * 前两家都不叫时最后一家强制叫 (游戏规则, 无需决策)。
 */
export function applyBid(state: GameState, seat: number, call: boolean): GameState {
  const b = state.bidding;
  if (!b || state.phase !== 'bidding') throw new Error('当前不在叫地主阶段');
  const pos = b.order.indexOf(seat);
  if (pos !== b.step) throw new Error('还没轮到你叫地主');

  const decisions = [...b.decisions];
  decisions[pos] = call;
  const players = state.players.map((p, i) => (i === seat ? { ...p, bid: call } : p));

  if (call) return becomeLandlord(state, seat, players, decisions);

  const next = b.step + 1;
  if (next >= b.order.length) {
    // 前两家都不叫 → 最后一家强制叫
    const forced = b.order[2];
    decisions[2] = true;
    return becomeLandlord(state, forced, players.map((p, i) => (i === forced ? { ...p, bid: true } : p)), decisions);
  }
  return { ...state, players, bidding: { ...b, decisions, step: next } };
}

function becomeLandlord(
  state: GameState,
  landlord: number,
  players: GameState['players'],
  decisions: (boolean | null)[],
): GameState {
  return {
    ...state,
    phase: 'playing',
    landlord,
    players: players.map((p, i) =>
      i === landlord ? { ...p, hand: sortHand([...p.hand, ...state.bottom]) } : p,
    ),
    bidding: { ...state.bidding!, decisions, landlord, step: state.bidding!.order.length },
    turn: landlord,
    lastPlay: null,
    passes: 0,
  };
}

/** 应用一次出牌/不出, 返回新状态 (非法动作抛错) */
export function applyAction(state: GameState, index: number, action: PlayAction): GameState {
  if (state.phase !== 'playing') throw new Error('当前不在出牌阶段');
  if (state.players.length !== 3) throw new Error('玩家数量无效');
  if (!Number.isInteger(index) || index < 0 || index >= state.players.length)
    throw new Error('玩家座位无效');
  if (state.landlord === null) throw new Error('地主尚未确定');
  if (index !== state.turn) throw new Error('还没轮到该玩家出牌');

  const player = state.players[index];
  const players = state.players.map(p => ({ ...p }));

  if (action.type === 'pass') {
    if (state.lastPlay === null) throw new Error('先手不能不出');
    players[index] = { ...players[index], passed: true, played: null };
    const passes = state.passes + 1;
    if (passes === 2) {
      const trickWinner = state.lastPlay.index;
      return {
        ...state,
        players: players.map(p => ({ ...p, passed: false, played: null })),
        lastPlay: null,
        passes: 0,
        turn: trickWinner,
      };
    }
    return { ...state, players, passes, turn: (state.turn + 1) % 3 };
  }

  if (!Array.isArray(action.cards) || action.cards.length === 0)
    throw new Error('出牌不能为空');

  // 状态机是最终可信边界：只使用玩家手牌中的真实 Card，拒绝伪造、篡改或重复卡牌。
  const handById = new Map(player.hand.map(c => [c.id, c]));
  const seen = new Set<string>();
  const playedCards: Card[] = [];
  for (const submitted of action.cards) {
    if (seen.has(submitted.id)) throw new Error('同一张牌不能重复使用');
    seen.add(submitted.id);
    const actual = handById.get(submitted.id);
    if (!actual) throw new Error('所出的牌不在该玩家手牌中');
    if (actual.rank !== submitted.rank || actual.suit !== submitted.suit)
      throw new Error('卡牌信息与玩家手牌不一致');
    playedCards.push(actual);
  }

  const shape = classify(playedCards);
  if (!shape) throw new Error('不是合法牌型');
  if (state.lastPlay && !canBeat(shape, state.lastPlay.shape)) throw new Error('压不过上家');

  const ids = new Set(playedCards.map(c => c.id));
  const remainingHand = player.hand.filter(c => !ids.has(c.id));
  if (player.hand.length - remainingHand.length !== playedCards.length)
    throw new Error('出牌后手牌数量不一致');

  const playedSnapshot = playedCards.map(c => ({ ...c }));
  players[index] = {
    ...players[index],
    hand: remainingHand,
    played: playedSnapshot,
    passed: false,
  };

  const lastPlay = { index, cards: playedSnapshot.map(c => ({ ...c })), shape };
  const history = [...state.history, { index, cards: playedSnapshot.map(c => ({ ...c })), shape: { ...shape } }];
  if (players[index].hand.length === 0)
    return { ...state, players, phase: 'ended', winner: index, lastPlay, passes: 0, history };

  return { ...state, players, lastPlay, passes: 0, turn: (state.turn + 1) % 3, history };
}
