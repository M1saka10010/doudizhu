import type { Card } from './types';

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', C: '♣', D: '♦' };
const RANK_LABEL: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};
const RANK_TOKEN: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
};

/** 显示名, 如 "3♠"、"大王" */
export function cardLabel(c: Card): string {
  if (c.rank === 16) return '小王';
  if (c.rank === 17) return '大王';
  return `${RANK_LABEL[c.rank]}${SUIT_SYMBOL[c.suit!]}`;
}

export function isRed(c: Card): boolean {
  return c.suit === 'H' || c.suit === 'D' || c.rank >= 16;
}

/** AI 交互用的紧凑记号, 如 "3S"、"10H"、"SJ"、"BJ" */
export function cardToken(c: Card): string {
  if (c.rank === 16) return 'SJ';
  if (c.rank === 17) return 'BJ';
  return `${RANK_TOKEN[c.rank]}${c.suit}`;
}

/** 按牌面文本反查手牌中的一张 (用于解析 AI 返回的牌) */
export function tokenToCard(token: string, hand: Card[]): Card | null {
  return hand.find(c => cardToken(c) === token) ?? null;
}

export function handTokens(hand: Card[]): string[] {
  return hand.map(cardToken);
}

/** 手牌文本, 如 "3S 3H 10C SJ BJ" */
export function handText(hand: Card[]): string {
  return handTokens(hand).join(' ');
}
