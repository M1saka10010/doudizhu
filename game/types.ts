export type Suit = 'S' | 'H' | 'C' | 'D';

export interface Card {
  /** 全局唯一编号 */
  id: string;
  /** 3-10=3..10, J=11, Q=12, K=13, A=14, 2=15, 小王=16, 大王=17 */
  rank: number;
  /** 大小王为 null */
  suit: Suit | null;
}

export interface HandShape {
  name: HandName;
  /** 比较大小的主牌 */
  mainRank: number;
  /** 总张数 */
  size: number;
}

export type HandName =
  | 'single'
  | 'pair'
  | 'triple'
  | 'tripleWithSingle'
  | 'tripleWithPair'
  | 'straight'
  | 'pairChain'
  | 'airplane'
  | 'airplaneWithSingles'
  | 'airplaneWithPairs'
  | 'fourWithTwo'
  | 'fourWithTwoPairs'
  | 'bomb'
  | 'rocket';

export interface PlayerState {
  name: string;
  isAI: boolean;
  hand: Card[];
  /** 最近一次出的牌 (用于展示) */
  played: Card[] | null;
  passed: boolean;
  /** 叫地主决定: true=叫, false=不叫, null=未决定 */
  bid: boolean | null;
}

export interface GameState {
  phase: 'bidding' | 'playing' | 'ended';
  players: PlayerState[];
  landlord: number | null;
  bottom: Card[];
  /** 当前轮到谁出牌 */
  turn: number;
  /** 当前台面上的牌 (null = 新一轮, 先手) */
  lastPlay: { index: number; cards: Card[]; shape: HandShape } | null;
  /** 自上一次出牌以来的连续 pass 次数 */
  passes: number;
  winner: number | null;
  /** 叫地主流程状态 (phase=bidding 时活跃) */
  bidding: BiddingState | null;
  /** 本局每一手的出牌记录 (供 AI 推断场上剩余牌) */
  history: PlayRecord[];
}

export interface PlayRecord {
  /** 出牌人座位 */
  index: number;
  cards: Card[];
  shape: HandShape;
}

export interface BiddingState {
  /** 叫地主顺序 (随机起点) */
  order: number[];
  /** 当前叫到第几家 (order 的下标) */
  step: number;
  /** 各家决定 (按 order 顺序, 未决定为 null) */
  decisions: (boolean | null)[];
  /** 最终地主 (未定为 null) */
  landlord: number | null;
}

export type PlayAction = { type: 'play'; cards: Card[] } | { type: 'pass' };
