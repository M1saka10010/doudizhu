import { describe, expect, it } from 'vitest';
import type { Card, GameState } from './types';
import { applyAction, applyBid, deal, sortHand, startBidding } from './engine';
import { isValidGameState } from './stateValidation';

function baseGame(): GameState {
  const { hands, bottom } = deal(() => 0.42);
  return {
    phase: 'bidding',
    players: hands.map((hand, i) => ({
      name: `P${i}`,
      isAI: i !== 0,
      hand: sortHand(hand),
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
    bidding: startBidding(() => 0),
    history: [],
  };
}

describe('持久化牌局校验', () => {
  it('接受状态机生成的叫地主、出牌和清台状态', () => {
    const bidding = baseGame();
    expect(isValidGameState(bidding)).toBe(true);

    let playing = applyBid(bidding, 0, true);
    expect(isValidGameState(playing)).toBe(true);

    playing = applyAction(playing, 0, { type: 'play', cards: [playing.players[0].hand.at(-1)!] });
    expect(isValidGameState(playing)).toBe(true);
    playing = applyAction(playing, 1, { type: 'pass' });
    expect(isValidGameState(playing)).toBe(true);
    playing = applyAction(playing, 2, { type: 'pass' });
    expect(isValidGameState(playing)).toBe(true);
  });

  it('拒绝重复牌、篡改牌面、越界回合和不一致台面', () => {
    const valid = applyBid(baseGame(), 0, true);

    const duplicate = structuredClone(valid);
    duplicate.players[1].hand[0] = { ...duplicate.players[0].hand[0] };
    expect(isValidGameState(duplicate)).toBe(false);

    const tampered = structuredClone(valid);
    tampered.players[0].hand[0] = { ...tampered.players[0].hand[0], rank: 3 } as Card;
    expect(isValidGameState(tampered)).toBe(false);

    const badTurn = structuredClone(valid) as GameState & { turn: number };
    badTurn.turn = 3;
    expect(isValidGameState(badTurn)).toBe(false);

    const played = applyAction(valid, 0, { type: 'play', cards: [valid.players[0].hand.at(-1)!] });
    const badLastPlay = structuredClone(played);
    badLastPlay.lastPlay!.index = 1;
    expect(isValidGameState(badLastPlay)).toBe(false);
  });
});
