import type { Card } from '../../game/types';
import { isRed } from '../../game/cards';

const RANK_CHAR: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
};
const SUIT_CHAR: Record<string, string> = { S: '♠', H: '♥', C: '♣', D: '♦' };

export function CardView({ card, selected, faceDown, style }: {
  card: Card;
  selected?: boolean;
  faceDown?: boolean;
  /** 手牌让位用的位移 (选中上浮 / 相邻牌让位) */
  style?: React.CSSProperties;
}) {
  const cls = ['card'];
  if (selected) cls.push('selected');
  if (faceDown) cls.push('face-down');
  const red = isRed(card);

  return (
    <div className={cls.join(' ')} style={style} aria-pressed={selected}>
      {faceDown ? (
        <div className="card-back-pattern" />
      ) : card.rank >= 16 ? (
        <>
          <span className={`card-rank ${red ? 'red' : ''}`}>{card.rank === 17 ? '大' : '小'}</span>
          <span className={`card-joker ${red ? 'red' : ''}`}>王</span>
          <span className="card-corner-bot">{card.rank === 17 ? '大' : '小'}王</span>
        </>
      ) : (
        <>
          <span className={`card-rank ${red ? 'red' : ''} ${card.rank === 10 ? 'wide' : ''}`}>{RANK_CHAR[card.rank]}</span>
          <span className={`card-suit ${red ? 'red' : ''}`}>{SUIT_CHAR[card.suit!]}</span>
          <span className={`card-pip ${red ? 'red' : ''}`} aria-hidden="true">{SUIT_CHAR[card.suit!]}</span>
          <span className={`card-corner-bot ${red ? 'red' : ''}`}>{SUIT_CHAR[card.suit!]}</span>
        </>
      )}
    </div>
  );
}
