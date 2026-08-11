import type { PlayerState } from '../../game/types';
import { CardFan, CardBacks } from './HandView';

export function OpponentSeat({ player, isLandlord, thinking, turnActive }: {
  player: PlayerState;
  isLandlord: boolean;
  thinking: boolean;
  turnActive: boolean;
}) {
  return (
    <div className={`opponent ${turnActive ? 'active' : ''}`}>
      <div className="opp-row">
        <div className="avatar">{player.isAI ? 'AI' : '你'}</div>
        <div className="opp-info">
          <div className="opp-name">
            {player.name}
            {isLandlord && <span className="landlord-badge">地主</span>}
            {!isLandlord && player.bid !== null && <span className="farmer-badge">农民</span>}
          </div>
          <div className="opp-cards">
            <CardBacks count={player.hand.length} />
            <span className="opp-count">{player.hand.length} 张</span>
          </div>
        </div>
        {thinking && (
          <div className="thinking">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
            <span className="thinking-text">思考中</span>
          </div>
        )}
        {player.passed && !thinking && <div className="passed-tag">不出</div>}
      </div>
      {player.played && (
        <div className="opp-played">
          <CardFan cards={player.played} />
        </div>
      )}
    </div>
  );
}
