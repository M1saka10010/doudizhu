import type { Card, GameState, HandShape, PlayRecord, PlayerState } from './types';
import { classify } from './rules';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSeat = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 2;

function expectedCard(id: string): { rank: number; suit: Card['suit'] } | null {
  if (id === 'SJ') return { rank: 16, suit: null };
  if (id === 'BJ') return { rank: 17, suit: null };
  const match = id.match(/^(3|4|5|6|7|8|9|10|11|12|13|14|15)([SHCD])$/);
  return match ? { rank: Number(match[1]), suit: match[2] as Card['suit'] } : null;
}

function isCard(value: unknown): value is Card {
  if (!isRecord(value) || typeof value.id !== 'string') return false;
  const expected = expectedCard(value.id);
  return !!expected && value.rank === expected.rank && value.suit === expected.suit;
}

function isCardArray(value: unknown, max = 54): value is Card[] {
  return Array.isArray(value) && value.length <= max && value.every(isCard);
}

function sameShape(a: HandShape, b: HandShape): boolean {
  return a.name === b.name && a.mainRank === b.mainRank && a.size === b.size;
}

function isPlayRecord(value: unknown): value is PlayRecord {
  if (!isRecord(value) || !isSeat(value.index) || !isCardArray(value.cards, 20) || !isRecord(value.shape))
    return false;
  const shape = classify(value.cards);
  return shape !== null && sameShape(shape, value.shape as unknown as HandShape);
}

function isPlayer(value: unknown): value is PlayerState {
  return (
    isRecord(value) &&
    typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 40 &&
    typeof value.isAI === 'boolean' &&
    isCardArray(value.hand, 20) &&
    (value.played === null || isCardArray(value.played, 20)) &&
    typeof value.passed === 'boolean' &&
    (value.bid === null || typeof value.bid === 'boolean')
  );
}

function hasUniqueIds(cards: Card[]): boolean {
  return new Set(cards.map(c => c.id)).size === cards.length;
}

function sameCards(a: Card[], b: Card[]): boolean {
  return a.length === b.length && a.every((card, i) => card.id === b[i].id);
}

/** 验证从浏览器存储恢复的完整牌局，拒绝损坏、篡改或旧结构不兼容的数据。 */
export function isValidGameState(value: unknown): value is GameState {
  if (!isRecord(value)) return false;
  if (value.phase !== 'bidding' && value.phase !== 'playing' && value.phase !== 'ended') return false;
  if (!Array.isArray(value.players) || value.players.length !== 3 || !value.players.every(isPlayer)) return false;
  if (!isCardArray(value.bottom, 3) || value.bottom.length !== 3 || !hasUniqueIds(value.bottom)) return false;
  if (!isSeat(value.turn) || !Number.isInteger(value.passes) || (value.passes as number) < 0 || (value.passes as number) > 1)
    return false;
  if (value.landlord !== null && !isSeat(value.landlord)) return false;
  if (value.winner !== null && !isSeat(value.winner)) return false;
  if (!Array.isArray(value.history) || !value.history.every(isPlayRecord)) return false;
  if (value.lastPlay !== null && !isPlayRecord(value.lastPlay)) return false;

  const bidding = value.bidding;
  if (!isRecord(bidding)) return false;
  if (!Array.isArray(bidding.order) || bidding.order.length !== 3 ||
      new Set(bidding.order).size !== 3 || !bidding.order.every(isSeat)) return false;
  if (!Number.isInteger(bidding.step) || (bidding.step as number) < 0 || (bidding.step as number) > 3) return false;
  if (!Array.isArray(bidding.decisions) || bidding.decisions.length !== 3 ||
      !bidding.decisions.every(d => d === null || typeof d === 'boolean')) return false;
  if (bidding.landlord !== null && !isSeat(bidding.landlord)) return false;

  const players = value.players as PlayerState[];
  const history = value.history as PlayRecord[];
  const passes = value.passes as number;
  const handCards = players.flatMap(p => p.hand);
  const historyCards = history.flatMap(record => record.cards);
  if (!hasUniqueIds(handCards) || !hasUniqueIds(historyCards)) return false;

  if (value.phase === 'bidding') {
    if (value.landlord !== null || value.winner !== null || bidding.landlord !== null) return false;
    if ((bidding.step as number) > 2 || value.lastPlay !== null || value.passes !== 0 || history.length !== 0) return false;
    if (!players.every(p => p.hand.length === 17 && p.played === null && !p.passed)) return false;
    if (!hasUniqueIds([...handCards, ...(value.bottom as Card[])])) return false;
    for (let i = 0; i < 3; i++) {
      if (i < (bidding.step as number) && bidding.decisions[i] !== false) return false;
      if (i >= (bidding.step as number) && bidding.decisions[i] !== null) return false;
      if (players[bidding.order[i] as number].bid !== bidding.decisions[i]) return false;
    }
    return true;
  }

  if (!isSeat(value.landlord) || bidding.landlord !== value.landlord || bidding.step !== 3) return false;
  const landlordPosition = bidding.order.indexOf(value.landlord);
  if (landlordPosition < 0) return false;
  for (let i = 0; i < 3; i++) {
    const expected = i < landlordPosition ? false : i === landlordPosition ? true : null;
    if (bidding.decisions[i] !== expected || players[bidding.order[i] as number].bid !== expected)
      return false;
  }
  if (value.phase === 'playing' && value.winner !== null) return false;
  if (value.phase === 'ended' && !isSeat(value.winner)) return false;
  if (handCards.length + historyCards.length !== 54 || !hasUniqueIds([...handCards, ...historyCards])) return false;
  if (value.phase === 'playing' && players.some(p => p.hand.length === 0)) return false;

  // 每张底牌必须仍在地主手中，或已经由地主打出，不能出现在农民区域。
  const landlordHandIds = new Set(players[value.landlord].hand.map(c => c.id));
  const landlordHistoryIds = new Set(
    history.filter(record => record.index === value.landlord).flatMap(record => record.cards.map(c => c.id)),
  );
  if (!(value.bottom as Card[]).every(card => landlordHandIds.has(card.id) || landlordHistoryIds.has(card.id)))
    return false;

  if (value.lastPlay === null) {
    if (value.passes !== 0) return false;
  } else {
    const last = history.at(-1);
    if (!last || last.index !== value.lastPlay.index || !sameCards(last.cards, value.lastPlay.cards) ||
        !sameShape(last.shape, value.lastPlay.shape)) return false;
    if (value.phase === 'playing' && value.turn !== (value.lastPlay.index + passes + 1) % 3)
      return false;
  }
  if (value.phase === 'ended') {
    if (value.passes !== 0 || value.turn !== value.winner || value.lastPlay === null ||
        players[value.winner as number].hand.length !== 0 || value.lastPlay.index !== value.winner ||
        players.some((p, i) => i !== value.winner && p.hand.length === 0)) return false;
  }
  return true;
}
