import { useState } from 'react';
import { useGame } from './hooks/useGame';
import { CardView } from './components/CardView';
import { HandView, CardFan } from './components/HandView';
import { OpponentSeat } from './components/OpponentSeat';
import { SettingsModal } from './components/SettingsModal';
import { HAND_NAMES } from '../game/rules';

const ROLE: Record<number, string> = { 0: '你', 1: 'AI·小南', 2: 'AI·小北' };

export default function App() {
  const g = useGame();
  const [showSettings, setShowSettings] = useState(false);
  const [logOpen, setLogOpen] = useState(false); // 对局记录默认折叠
  const { game } = g;
  const landlord = game.landlord;
  const turnName = game.players[game.turn]?.name ?? '';

  const lastPlayerName = game.lastPlay ? ROLE[game.lastPlay.index] : null;
  const lastShape = game.lastPlay?.shape;
  const winner = game.winner !== null ? game.players[game.winner] : null;

  const banner =
    game.phase === 'ended'
      ? `${winner!.name} (${game.winner === game.landlord ? '地主' : '农民'}) 获胜!`
      : game.phase === 'bidding'
        ? `${ROLE[game.bidding!.order[game.bidding!.step]]} 正在叫地主…`
        : game.lastPlay
          ? `${lastPlayerName} 出了 ${lastShape ? HAND_NAMES[lastShape.name] : ''}`
          : `轮到 ${turnName} 先手出牌`;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">♠</span>
          <h1>AI 斗地主</h1>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={g.newGame}>新对局</button>
          <button className="btn ghost" onClick={() => setShowSettings(true)}>AI 设置</button>
        </div>
      </header>

      <main className="table">
        <OpponentSeat
          player={game.players[2]}
          isLandlord={landlord === 2}
          thinking={g.thinking === 2}
          turnActive={game.phase === 'playing' && game.turn === 2}
        />

        <section className="center">
          <div className="bottom-cards">
            {game.phase === 'bidding' ? (
              <div className="card-fan">
                {game.bottom.map(c => (
                  <CardView key={c.id} card={c} faceDown />
                ))}
              </div>
            ) : (
              <div className="card-fan bottom-revealed">
                {game.bottom.map(c => (
                  <CardView key={c.id} card={c} />
                ))}
                <span className="bottom-label">底牌 → {ROLE[landlord!]}</span>
              </div>
            )}
          </div>

          <div className="center-play">
            {game.lastPlay && (
              <div className="played-area">
                <CardFan cards={game.lastPlay.cards} />
                <div className="played-label">
                  {lastPlayerName} · {lastShape ? HAND_NAMES[lastShape.name] : ''}
                </div>
              </div>
            )}
            <div className={`banner ${game.phase === 'ended' ? 'win' : ''}`}>{banner}</div>
            {game.phase === 'ended' && (
              <button className="btn primary" onClick={g.newGame}>再来一局</button>
            )}
          </div>
        </section>

        <OpponentSeat
          player={game.players[1]}
          isLandlord={landlord === 1}
          thinking={g.thinking === 1}
          turnActive={game.phase === 'playing' && game.turn === 1}
        />

        <section className="user-area">
          <div className="user-main">
            <div className="user-label">
              <span className={`role-tag ${landlord === 0 ? 'landlord' : ''}`}>
                {landlord === 0 ? '地主' : '农民'}
              </span>
              <span className="turn-hint">
                {game.phase === 'playing' && game.turn === 0 && '轮到你出牌'}
              </span>
            </div>
            <HandView
              hand={game.players[0].hand}
              selected={g.selected}
              onToggle={g.toggleSelect}
              onSetRange={g.setRangeSelect}
            />

            {game.phase === 'bidding' && g.isUserBidding && (
              <div className="action-bar">
                <button className="btn primary" onClick={() => g.userBid(true)} disabled={!g.isUserBidding}>
                  叫地主
                </button>
                {!g.userBidForced && (
                  <button className="btn" onClick={() => g.userBid(false)}>不叫</button>
                )}
                {g.userBidForced && <span className="hint-text">前两家都不叫, 你必须叫地主</span>}
              </div>
            )}

            {game.phase === 'playing' && (
              <div className="action-bar">
                <span className="selected-count">
                  {g.selected.size > 0 ? `已选 ${g.selected.size} 张` : ''}
                </span>
                <button className="btn primary" onClick={g.playSelected} disabled={!g.isUserTurn}>
                  出牌
                </button>
                <button className="btn" onClick={g.passTurn} disabled={!g.canPass}>
                  不出
                </button>
                <button className="btn ghost" onClick={g.hint} disabled={!g.isUserTurn}>
                  提示
                </button>
              </div>
            )}
          </div>

          <aside className={`log-panel ${logOpen ? '' : 'collapsed'}`}>
            <button
              className="log-title"
              onClick={() => setLogOpen(o => !o)}
              aria-expanded={logOpen}
            >
              <span>对局记录</span>
              <span className="log-toggle">{logOpen ? '▾' : '▸'}</span>
            </button>
            <div className="log-list">
              {g.log.slice(-8).map(e => (
                <div key={e.id} className={`log-entry ${e.kind}`}>
                  <div>{e.text}</div>
                  {e.detail && (
                    <div className="log-detail">
                      思考: {e.detail.length > 140 ? `${e.detail.slice(0, 140)}…` : e.detail}
                    </div>
                  )}
                </div>
              ))}
              {g.log.length === 0 && <div className="log-empty">等待开局…</div>}
            </div>
          </aside>
        </section>
      </main>

      {g.aiError && (
        <div className="error-banner" role="alert">
          <span>
            <strong>{ROLE[g.aiError.seat]}</strong> 决策失败: {g.aiError.message}
          </span>
          <button className="btn small" onClick={g.retryAi}>重试</button>
        </div>
      )}

      {g.toast && <div className="toast">{g.toast}</div>}
      {showSettings && (
        <SettingsModal
          settings={g.settings}
          onSave={s => { g.updateSettings(s); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
