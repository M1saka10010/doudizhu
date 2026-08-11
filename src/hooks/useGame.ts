import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Card, GameState } from '../../game/types';
import { canBeat, classify, HAND_NAMES, smallestBeatingPlay, bestLeadPlay } from '../../game/rules';
import { startBidding, deal, sortHand, applyAction, applyBid } from '../../game/engine';
import { cardLabel, cardToken, tokenToCard } from '../../game/cards';
import { isValidGameState } from '../../game/stateValidation';
import {
  aiBid,
  aiPlay,
  loadSettings,
  saveSettings,
  type AiSettings,
} from '../ai/client';

export const PLAYER_NAMES = ['你', 'AI·小南', 'AI·小北'];

const GAME_STORAGE_KEY = 'doudizhu-ai-game';
const LOG_STORAGE_KEY = 'doudizhu-ai-log';
const GAME_STORAGE_VERSION = 1;

/** 从 localStorage 恢复牌局 (刷新页面不重置) */
function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(GAME_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const candidate =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed && 'game' in parsed
        ? (parsed as { version?: unknown; game?: unknown }).version === GAME_STORAGE_VERSION
          ? (parsed as { game: unknown }).game
          : null
        : parsed; // 兼容迁移旧版未包装但结构完整的存档
    if (isValidGameState(candidate)) return candidate;
    localStorage.removeItem(GAME_STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (!raw) return [];
    const log: unknown = JSON.parse(raw);
    if (!Array.isArray(log)) return [];
    return log.filter((entry): entry is LogEntry => {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as Partial<LogEntry>;
      return Number.isInteger(e.id) && typeof e.text === 'string' && e.text.length <= 4000 &&
        (e.kind === 'play' || e.kind === 'pass' || e.kind === 'bid' || e.kind === 'info' || e.kind === 'win' || e.kind === 'error') &&
        (e.detail === undefined || (typeof e.detail === 'string' && e.detail.length <= 16000));
    }).slice(-25);
  } catch {
    return [];
  }
}

export interface LogEntry {
  id: number;
  text: string;
  kind: 'play' | 'pass' | 'bid' | 'info' | 'win' | 'error';
  /** AI 思考内容 (thinking 模型输出, 可选) */
  detail?: string;
}

export interface AiErrorInfo {
  seat: number;
  kind: 'bid' | 'play';
  message: string;
}

interface UiState {
  game: GameState;
  selected: Set<string>;
  thinking: number | null;
  aiError: AiErrorInfo | null;
  log: LogEntry[];
}

type UiAction =
  | { type: 'new-game'; state: GameState }
  | { type: 'bid'; seat: number; call: boolean; entry?: LogEntry; failure?: AiErrorInfo }
  | { type: 'play'; index: number; cards: Card[]; entry?: LogEntry; failure?: AiErrorInfo }
  | { type: 'pass'; index: number; entry?: LogEntry; failure?: AiErrorInfo }
  | { type: 'select'; id: string }
  | { type: 'select-many'; ids: string[]; mode: boolean }
  | { type: 'clear-select' }
  | { type: 'thinking'; seat: number | null }
  | { type: 'ai-error'; err: AiErrorInfo | null }
  | { type: 'log'; entry: LogEntry };

function initGame(): GameState {
  const { hands, bottom } = deal();
  return {
    phase: 'bidding',
    players: hands.map((h, i) => ({
      name: PLAYER_NAMES[i],
      isAI: i !== 0,
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
    bidding: startBidding(),
    history: [],
  };
}

function reducer(state: UiState, action: UiAction): UiState {
  const appendEntry = (next: UiState, entry?: LogEntry): UiState =>
    entry ? { ...next, log: [...state.log.slice(-24), entry] } : next;

  switch (action.type) {
    case 'new-game':
      return { game: action.state, selected: new Set(), thinking: null, aiError: null, log: [] };
    case 'bid': {
      try {
        const game = applyBid(state.game, action.seat, action.call);
        return appendEntry({ ...state, game, aiError: null }, action.entry);
      } catch (e) {
        return action.failure
          ? { ...state, aiError: { ...action.failure, message: e instanceof Error ? e.message : String(e) } }
          : state;
      }
    }
    case 'play': {
      try {
        const game = applyAction(state.game, action.index, { type: 'play', cards: action.cards });
        return appendEntry({ ...state, game, selected: new Set() }, action.entry);
      } catch (e) {
        return action.failure
          ? { ...state, aiError: { ...action.failure, message: e instanceof Error ? e.message : String(e) } }
          : state;
      }
    }
    case 'pass': {
      try {
        const game = applyAction(state.game, action.index, { type: 'pass' });
        return appendEntry({ ...state, game }, action.entry);
      } catch (e) {
        return action.failure
          ? { ...state, aiError: { ...action.failure, message: e instanceof Error ? e.message : String(e) } }
          : state;
      }
    }
    case 'select': {
      const selected = new Set(state.selected);
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { ...state, selected };
    }
    case 'select-many': {
      const selected = new Set(state.selected);
      for (const id of action.ids) {
        if (action.mode) selected.add(id);
        else selected.delete(id);
      }
      return { ...state, selected };
    }
    case 'clear-select':
      return { ...state, selected: new Set() };
    case 'thinking':
      return { ...state, thinking: action.seat };
    case 'ai-error':
      return { ...state, aiError: action.err };
    case 'log':
      return { ...state, log: [...state.log.slice(-24), action.entry] };
  }
}

let logId = 0;

function makeLogEntry(text: string, kind: LogEntry['kind'] = 'info', detail?: string): LogEntry {
  return { id: ++logId, text, kind, detail };
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const restoredLog = loadLog();
    logId = restoredLog.reduce((m, e) => Math.max(m, e.id), 0);
    return {
      game: loadGame() ?? initGame(),
      selected: new Set<string>(),
      thinking: null,
      aiError: null,
      log: restoredLog,
    };
  });
  const [settings, setSettings] = useState<AiSettings>(loadSettings);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 牌局与日志持久化: 刷新页面不重置
  useEffect(() => {
    try {
      localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify({ version: GAME_STORAGE_VERSION, game: state.game }));
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(state.log));
    } catch {
      // localStorage 不可用/超限时静默跳过, 不影响游戏
    }
  }, [state.game, state.log]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const log = useCallback(
    (text: string, kind: LogEntry['kind'] = 'info', detail?: string) => {
      dispatch({ type: 'log', entry: makeLogEntry(text, kind, detail) });
    },
    [],
  );

  const updateSettings = useCallback((s: AiSettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const newGame = useCallback(() => {
    dispatch({ type: 'new-game', state: initGame() });
  }, []);

  // ── 叫地主阶段: 驱动 AI 与强制叫 ──
  useEffect(() => {
    const g = state.game;
    if (g.phase !== 'bidding') return;
    const b = g.bidding;
    if (!b || b.step >= b.order.length || b.landlord !== null) return;
    const seat = b.order[b.step];
    const forced = b.step === 2 && b.decisions[0] === false && b.decisions[1] === false;
    const name = g.players[seat].name;

    if (state.aiError) return;

    if (forced) {
      dispatch({
        type: 'bid',
        seat,
        call: true,
        entry: makeLogEntry(`${name} 必须叫地主 (前两家都不叫)`, 'bid'),
        failure: { seat, kind: 'bid', message: '' },
      });
      return;
    }
    if (!g.players[seat].isAI) return;

    dispatch({ type: 'thinking', seat });
    let cancelled = false;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const d = await aiBid({
          config: settingsRef.current,
          seat,
          hand: g.players[seat].hand,
          bidOrder: b.order,
          bidPosition: b.step,
          previousBids: b.decisions,
          players: g.players.map(p => ({ name: p.name, remaining: p.hand.length })),
        }, controller.signal);
        if (cancelled) return;
        dispatch({
          type: 'bid',
          seat,
          call: d.action === 'call',
          entry: makeLogEntry(
            `${name} ${d.action === 'call' ? '叫地主!' : '不叫'}${d.reason ? ` — ${d.reason}` : ''}`,
            'bid',
            d.reasoning,
          ),
          failure: { seat, kind: 'bid', message: '' },
        });
        dispatch({ type: 'thinking', seat: null });
      } catch (e) {
        if (cancelled) return;
        dispatch({ type: 'thinking', seat: null });
        dispatch({
          type: 'ai-error',
          err: { seat, kind: 'bid', message: e instanceof Error ? e.message : String(e) },
        });
      }
    }, 900);
    return () => {
      cancelled = true;
      clearTimeout(t);
      controller.abort();
    };
  }, [state.game, state.aiError]);

  // ── 出牌阶段: 驱动 AI 回合 ──
  useEffect(() => {
    const g = state.game;
    if (g.phase !== 'playing') return;
    const seat = g.turn;
    const p = g.players[seat];
    if (!p.isAI || state.aiError) return;

    dispatch({ type: 'thinking', seat });
    let cancelled = false;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const d = await aiPlay({
          config: settingsRef.current,
          seat,
          hand: p.hand,
          lastPlay: g.lastPlay
            ? { ownerSeat: g.lastPlay.index, cards: g.lastPlay.cards.map(cardToken) }
            : null,
          landlordSeat: g.landlord!,
          players: g.players.map(pl => ({ name: pl.name, remaining: pl.hand.length })),
          history: g.history.map(r => ({
            ownerSeat: r.index,
            cards: r.cards.map(cardToken),
          })),
        }, controller.signal);
        if (cancelled) return;
        dispatch({ type: 'thinking', seat: null });
        if (d.action === 'pass') {
          dispatch({
            type: 'pass',
            index: seat,
            entry: makeLogEntry(`${p.name} 不出`, 'pass', d.reasoning),
            failure: { seat, kind: 'play', message: '' },
          });
        } else {
          const cards = d.cards
            .map(t => tokenToCard(t, p.hand))
            .filter((c): c is Card => c !== null);
          dispatch({
            type: 'play',
            index: seat,
            cards,
            entry: makeLogEntry(
              `${p.name} 出了 ${d.shapeName ?? ''}${d.reason ? ` — ${d.reason}` : ''}`,
              'play',
              d.reasoning,
            ),
            failure: { seat, kind: 'play', message: '' },
          });
        }
      } catch (e) {
        if (cancelled) return;
        dispatch({ type: 'thinking', seat: null });
        dispatch({
          type: 'ai-error',
          err: { seat, kind: 'play', message: e instanceof Error ? e.message : String(e) },
        });
      }
    }, 800 + Math.random() * 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
      controller.abort();
    };
  }, [state.game, state.aiError, log]);

  // ── 结算 ──
  useEffect(() => {
    const g = state.game;
    if (g.phase !== 'ended' || g.winner === null) return;
    const w = g.players[g.winner];
    const role = g.winner === g.landlord ? '地主' : '农民';
    log(`${w.name} (${role}) 出完了所有牌, 本局结束!`, 'win');
  }, [state.game, log]);

  // ── 用户操作 ──
  const isUserTurn = state.game.phase === 'playing' && state.game.turn === 0;
  const canPass = isUserTurn && state.game.lastPlay !== null;

  const toggleSelect = useCallback((id: string) => {
    dispatch({ type: 'select', id });
  }, []);

  const setRangeSelect = useCallback((ids: string[], mode: boolean) => {
    dispatch({ type: 'select-many', ids, mode });
  }, []);

  const playSelected = useCallback(() => {
    const g = state.game;
    if (!isUserTurn) return;
    const cards = g.players[0].hand.filter(c => state.selected.has(c.id));
    if (cards.length === 0) {
      showToast('请先选择要出的牌');
      return;
    }
    const shape = classify(cards);
    if (!shape) {
      showToast('所选牌不是合法牌型');
      return;
    }
    if (g.lastPlay && !canBeat(shape, g.lastPlay.shape)) {
      showToast('压不过上家的牌');
      return;
    }
    dispatch({
      type: 'play',
      index: 0,
      cards,
      entry: makeLogEntry(`你出了 ${HAND_NAMES[shape.name]} [${cards.map(cardLabel).join(' ')}]`, 'play'),
    });
  }, [state.game, state.selected, isUserTurn, showToast]);

  const passTurn = useCallback(() => {
    if (!canPass) return;
    dispatch({ type: 'pass', index: 0, entry: makeLogEntry('你不出', 'pass') });
  }, [canPass]);

  const hint = useCallback(() => {
    const g = state.game;
    if (!isUserTurn) return;
    const hand = g.players[0].hand;
    const cards = g.lastPlay ? smallestBeatingPlay(hand, g.lastPlay.shape) : bestLeadPlay(hand);
    if (!cards) {
      showToast('没有能压过的牌, 只能不出');
      return;
    }
    dispatch({ type: 'clear-select' });
    for (const c of cards) dispatch({ type: 'select', id: c.id });
  }, [state.game, isUserTurn, showToast]);

  const userBid = useCallback(
    (call: boolean) => {
      const g = state.game;
      if (g.phase !== 'bidding') return;
      const b = g.bidding!;
      const seat = b.order[b.step];
      if (seat !== 0 || b.landlord !== null) return;
      dispatch({
        type: 'bid',
        seat: 0,
        call,
        entry: makeLogEntry(`你 ${call ? '叫地主!' : '不叫'}`, 'bid'),
      });
    },
    [state.game],
  );

  const retryAi = useCallback(() => {
    dispatch({ type: 'ai-error', err: null });
  }, []);

  const isUserBidding = state.game.phase === 'bidding' && state.game.bidding?.order[state.game.bidding.step] === 0;
  const userBidForced =
    isUserBidding &&
    state.game.bidding!.step === 2 &&
    state.game.bidding!.decisions[0] === false &&
    state.game.bidding!.decisions[1] === false;

  return {
    game: state.game,
    selected: state.selected,
    thinking: state.thinking,
    aiError: state.aiError,
    log: state.log,
    settings,
    toast,
    isUserTurn,
    canPass,
    isUserBidding,
    userBidForced,
    updateSettings,
    newGame,
    toggleSelect,
    setRangeSelect,
    playSelected,
    passTurn,
    hint,
    userBid,
    retryAi,
  };
}
