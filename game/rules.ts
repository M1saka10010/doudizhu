import type { Card, HandName, HandShape } from './types';

export const HAND_NAMES: Record<HandName, string> = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  tripleWithSingle: '三带一',
  tripleWithPair: '三带二',
  straight: '顺子',
  pairChain: '连对',
  airplane: '飞机',
  airplaneWithSingles: '飞机带单',
  airplaneWithPairs: '飞机带对',
  fourWithTwo: '四带二',
  fourWithTwoPairs: '四带两对',
  bomb: '炸弹',
  rocket: '王炸',
};

/** 顺子/连对/飞机不允许包含的牌 (2 和大小王) */
const CHAIN_MAX = 14;

export function classify(cards: Card[]): HandShape | null {
  const n = cards.length;
  if (n === 0) return null;

  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const ranks = entries.map(([r]) => r);
  const consecutive = (arr: number[]) => arr.every((r, i) => i === 0 || r - arr[i - 1] === 1);
  const noHigh = (arr: number[]) => arr[arr.length - 1] <= CHAIN_MAX;

  if (n === 1) return { name: 'single', mainRank: ranks[0], size: 1 };
  if (n === 2) {
    if (counts.size === 1) return { name: 'pair', mainRank: ranks[0], size: 2 };
    if (ranks[0] === 16 && ranks[1] === 17) return { name: 'rocket', mainRank: 17, size: 2 };
    return null;
  }
  if (n === 3) {
    if (counts.size === 1) return { name: 'triple', mainRank: ranks[0], size: 3 };
    return null;
  }
  if (n === 4) {
    if (counts.size === 1) return { name: 'bomb', mainRank: ranks[0], size: 4 };
    const triple = entries.find(([, c]) => c === 3);
    if (triple) return { name: 'tripleWithSingle', mainRank: triple[0], size: 4 };
    return null;
  }

  if (entries.every(([, c]) => c === 1)) {
    if (n >= 5 && consecutive(ranks) && noHigh(ranks))
      return { name: 'straight', mainRank: ranks[ranks.length - 1], size: n };
    return null;
  }
  if (entries.every(([, c]) => c === 2)) {
    if (n >= 6 && consecutive(ranks) && noHigh(ranks))
      return { name: 'pairChain', mainRank: ranks[ranks.length - 1], size: n };
    return null;
  }
  if (entries.every(([, c]) => c === 3)) {
    if (ranks.length >= 2 && consecutive(ranks) && noHigh(ranks))
      return { name: 'airplane', mainRank: ranks[ranks.length - 1], size: n };
    return null;
  }
  if (n === 5 && counts.size === 2) {
    const triple = entries.find(([, c]) => c === 3);
    if (triple) return { name: 'tripleWithPair', mainRank: triple[0], size: 5 };
    return null;
  }

  // 飞机带翅膀: 连续三张 + 等量单张或对子 (三张可从 4 张同牌中取, 先于四带二检查)
  const tripleRanks = entries.filter(([, c]) => c >= 3).map(([r]) => r);
  if (tripleRanks.length >= 2 && consecutive(tripleRanks) && noHigh(tripleRanks)) {
    const k = tripleRanks.length;
    const rest = n - 3 * k;
    if (rest === k) {
      const left = new Map(counts);
      for (const r of tripleRanks) left.set(r, left.get(r)! - 3);
      if ([...left.values()].filter(c => c === 1).length === k)
        return { name: 'airplaneWithSingles', mainRank: tripleRanks[tripleRanks.length - 1], size: n };
    }
    if (rest === 2 * k) {
      const left = new Map(counts);
      for (const r of tripleRanks) left.set(r, left.get(r)! - 3);
      if ([...left.values()].filter(c => c === 2).length === k)
        return { name: 'airplaneWithPairs', mainRank: tripleRanks[tripleRanks.length - 1], size: n };
    }
  }

  // 四带二 / 四带两对
  const fours = entries.filter(([, c]) => c === 4);
  if (fours.length === 1) {
    const fourRank = fours[0][0];
    if (n === 6) return { name: 'fourWithTwo', mainRank: fourRank, size: 6 };
    if (n === 8) {
      const rest = entries.filter(([r]) => r !== fourRank);
      if (rest.length === 2 && rest.every(([, c]) => c === 2))
        return { name: 'fourWithTwoPairs', mainRank: fourRank, size: 8 };
    }
    return null;
  }
  return null;
}

/** a 是否能压过 b */
export function canBeat(a: HandShape, b: HandShape): boolean {
  if (a.name === 'rocket') return b.name !== 'rocket';
  if (b.name === 'rocket') return false;
  if (a.name === 'bomb') return b.name === 'bomb' ? a.mainRank > b.mainRank : true;
  if (b.name === 'bomb') return false;
  if (a.name !== b.name) return false;
  if (a.size !== b.size) return false;
  return a.mainRank > b.mainRank;
}

interface Group {
  rank: number;
  cards: Card[];
}

function groupHand(hand: Card[]): Group[] {
  const map = new Map<number, Card[]>();
  for (const c of hand) {
    const arr = map.get(c.rank) ?? [];
    arr.push(c);
    map.set(c.rank, arr);
  }
  return [...map.entries()]
    .map(([rank, cards]) => ({ rank, cards }))
    .sort((a, b) => a.rank - b.rank);
}

function lowestCards(cards: Card[], k: number): Card[] {
  return [...cards].sort((a, b) => a.rank - b.rank).slice(0, k);
}

/**
 * 生成能压过 last 的候选出牌 (last 为 null 时生成先手合法候选)。
 * 带翅膀的组合只生成一种确定性的翅膀选择 (最小张), 用于控制候选数量。
 */
export function getPlays(hand: Card[], last: HandShape | null): Card[][] {
  const groups = groupHand(hand);
  const plays: Card[][] = [];
  const seenPlays = new Set<string>();
  // 所有生成分支统一经过最终合法性与压制校验，避免某个分支漏掉大小比较。
  const push = (cards: Card[]) => {
    const shape = classify(cards);
    if (!shape || (last !== null && !canBeat(shape, last))) return;
    const key = cards.map(c => c.id).sort().join('|');
    if (seenPlays.has(key)) return;
    seenPlays.add(key);
    plays.push(cards);
  };
  const want = (name: HandName) => last === null || last.name === name;
  const rankOK = (name: HandName, rank: number) =>
    last === null || (last.name === name && rank > last.mainRank);
  const chainLen = (name: HandName, divisor: number) =>
    last !== null && last.name === name ? last.size / divisor : -1;

  // 单张 / 对子 / 三张
  for (const g of groups) {
    if (want('single') && rankOK('single', g.rank)) for (const c of g.cards) push([c]);
    if (g.cards.length >= 2 && want('pair') && rankOK('pair', g.rank)) push(g.cards.slice(0, 2));
    if (g.cards.length >= 3 && want('triple') && rankOK('triple', g.rank)) push(g.cards.slice(0, 3));
  }

  // 三带一 / 三带二
  if (want('tripleWithSingle')) {
    for (const t of groups) {
      if (t.cards.length < 3 || !rankOK('tripleWithSingle', t.rank)) continue;
      const triple = t.cards.slice(0, 3);
      const wings: Card[] = [];
      for (const g of groups)
        for (const c of g.cards)
          if (!(g.rank === t.rank && g.cards.indexOf(c) < 3)) wings.push(c);
      for (const w of wings) push([...triple, w]);
    }
  }
  if (want('tripleWithPair')) {
    for (const t of groups) {
      if (t.cards.length < 3 || !rankOK('tripleWithPair', t.rank)) continue;
      const triple = t.cards.slice(0, 3);
      for (const g of groups) {
        if (g.rank === t.rank || g.cards.length < 2) continue;
        push([...triple, ...g.cards.slice(0, 2)]);
      }
    }
  }

  // 顺子 / 连对 / 飞机 (滑动窗口)
  const windows = (minRun: number, minK: number, need: (g: Group) => boolean) => {
    const out: { lo: number; hi: number; k: number }[] = [];
    for (let lo = 3; lo <= CHAIN_MAX; lo++) {
      let hi = lo;
      while (hi <= CHAIN_MAX) {
        const g = groups.find(x => x.rank === hi);
        if (!g || !need(g)) break;
        hi++;
      }
      const run = hi - lo;
      if (run < minRun) continue;
      for (let k = minK; k <= run; k++) out.push({ lo, hi: lo + k - 1, k });
    }
    return out;
  };
  const windowCards = (lo: number, hi: number, take: (g: Group) => Card[]) => {
    const out: Card[] = [];
    for (let r = lo; r <= hi; r++) out.push(...take(groups.find(g => g.rank === r)!));
    return out;
  };

  if (want('straight')) {
    const L = chainLen('straight', 1);
    for (const w of windows(5, 5, g => g.cards.length >= 1)) {
      if (L !== -1 && w.k !== L) continue;
      if (L !== -1 && w.hi <= last!.mainRank) continue;
      push(windowCards(w.lo, w.hi, g => [g.cards[0]]));
    }
  }
  if (want('pairChain')) {
    const K = chainLen('pairChain', 2);
    for (const w of windows(3, 3, g => g.cards.length >= 2)) {
      if (K !== -1 && w.k !== K) continue;
      if (K !== -1 && w.hi <= last!.mainRank) continue;
      push(windowCards(w.lo, w.hi, g => g.cards.slice(0, 2)));
    }
  }
  if (want('airplane')) {
    const K = chainLen('airplane', 3);
    for (const w of windows(2, 2, g => g.cards.length >= 3)) {
      if (K !== -1 && w.k !== K) continue;
      if (K !== -1 && w.hi <= last!.mainRank) continue;
      push(windowCards(w.lo, w.hi, g => g.cards.slice(0, 3)));
    }
  }
  if (want('airplaneWithSingles')) {
    const K = chainLen('airplaneWithSingles', 4);
    for (const w of windows(2, 2, g => g.cards.length >= 3)) {
      if (K !== -1 && w.k !== K) continue;
      if (K !== -1 && w.hi <= last!.mainRank) continue;
      const used = new Set(windowCards(w.lo, w.hi, g => g.cards.slice(0, 3)).map(c => c.id));
      // 翅膀必须来自不同点数 (不能拆对), 取 k 个最低点数各一张
      const rest = hand.filter(c => !used.has(c.id));
      const byRank = new Map<number, Card[]>();
      for (const c of rest) {
        const arr = byRank.get(c.rank) ?? [];
        arr.push(c);
        byRank.set(c.rank, arr);
      }
      const wings = [...byRank.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(0, w.k)
        .flatMap(([, cs]) => cs.slice(0, 1));
      if (wings.length < w.k) continue;
      push([...windowCards(w.lo, w.hi, g => g.cards.slice(0, 3)), ...wings]);
    }
  }
  if (want('airplaneWithPairs')) {
    const K = chainLen('airplaneWithPairs', 5);
    for (const w of windows(2, 2, g => g.cards.length >= 3)) {
      if (K !== -1 && w.k !== K) continue;
      if (K !== -1 && w.hi <= last!.mainRank) continue;
      const inWindow = new Set<number>();
      for (let r = w.lo; r <= w.hi; r++) inWindow.add(r);
      const pairs = groups
        .filter(g => !inWindow.has(g.rank) && g.cards.length >= 2)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, w.k);
      if (pairs.length < w.k) continue;
      push([...windowCards(w.lo, w.hi, g => g.cards.slice(0, 3)), ...pairs.flatMap(g => g.cards.slice(0, 2))]);
    }
  }

  // 四带二 / 四带两对
  if (want('fourWithTwo')) {
    for (const f of groups) {
      if (f.cards.length !== 4) continue;
      const fourIds = new Set(f.cards.map(c => c.id));
      const rest = hand.filter(c => !fourIds.has(c.id));
      if (rest.length >= 2) push([...f.cards, ...lowestCards(rest, 2)]);
    }
  }
  if (want('fourWithTwoPairs')) {
    for (const f of groups) {
      if (f.cards.length !== 4) continue;
      const pairs = groups
        .filter(g => g.rank !== f.rank && g.cards.length >= 2)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 2);
      if (pairs.length < 2) continue;
      push([...f.cards, ...pairs.flatMap(g => g.cards.slice(0, 2))]);
    }
  }

  // 炸弹 / 王炸 (王炸不能被压, 因此压王炸时不生成任何选项)
  if (last === null || last.name !== 'rocket') {
    for (const g of groups) if (g.cards.length === 4) push(g.cards);
    const jokers = hand.filter(c => c.rank >= 16);
    if (jokers.length === 2) push(jokers);
  }

  const shape = (cards: Card[]) => classify(cards)!;
  plays.sort((a, b) => {
    const sa = shape(a);
    const sb = shape(b);
    const pa = sa.name === 'bomb' || sa.name === 'rocket' ? 1 : 0;
    const pb = sb.name === 'bomb' || sb.name === 'rocket' ? 1 : 0;
    if (pa !== pb) return pa - pb;
    if (sa.size !== sb.size) return sa.size - sb.size;
    return sa.mainRank - sb.mainRank;
  });
  return plays.slice(0, 200);
}

/** 跟牌时最小的合法压制 (不用炸弹, 除非别无选择); 无解返回 null */
export function smallestBeatingPlay(hand: Card[], last: HandShape): Card[] | null {
  const plays = getPlays(hand, last);
  const normal = plays.filter(p => {
    const s = classify(p)!;
    return s.name !== 'bomb' && s.name !== 'rocket';
  });
  const pool = normal.length > 0 ? normal : plays;
  return pool.length > 0 ? pool[0] : null;
}

/** 先手时建议出的牌: 优先出张数多的结构, 保留炸弹 */
export function bestLeadPlay(hand: Card[]): Card[] | null {
  if (hand.length === 0) return null;
  const plays = getPlays(hand, null);
  const normal = plays.filter(p => {
    const s = classify(p)!;
    return s.name !== 'bomb' && s.name !== 'rocket';
  });
  const pool = normal.length > 0 ? normal : plays;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const sa = classify(a)!;
    const sb = classify(b)!;
    if (sa.size !== sb.size) return sb.size - sa.size;
    return sa.mainRank - sb.mainRank;
  })[0];
}
