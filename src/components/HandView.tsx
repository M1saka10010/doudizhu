import { useRef, useState } from 'react';
import type { Card } from '../../game/types';
import { CardView } from './CardView';

export function HandView({ hand, selected, onToggle, onSetRange }: {
  hand: Card[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** 拖动划选: 把区间内所有牌设为选中/取消 (mode=true 选中) */
  onSetRange: (ids: string[], mode: boolean) => void;
}) {
  const drag = useRef<{
    startIdx: number;
    /** 本次拖动是"加入选中"还是"取消选中" (按下时起始牌的状态决定) */
    mode: boolean;
    /** 是否已产生位移 (区分点击与拖动) */
    moved: boolean;
    downX: number;
    downY: number;
    pointerType: string;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  /** 定位命中的牌: 与视觉一致 — 取鼠标坐标处最上层的那张牌 (扇形重叠时上层即所见) */
  const idxAt = (e: { clientX: number; clientY: number }, el: HTMLElement): number => {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const card = hit?.closest('.card');
    if (!card || !el.contains(card)) return -1;
    const cards = el.querySelectorAll<HTMLElement>('.card');
    for (let i = 0; i < cards.length; i++) {
      if (cards[i] === card) return i;
    }
    return -1;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const idx = idxAt(e, e.currentTarget);
    if (idx < 0) return;
    drag.current = {
      startIdx: idx,
      mode: !selected.has(hand[idx].id),
      moved: false,
      downX: e.clientX,
      downY: e.clientY,
      pointerType: e.pointerType,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // 触屏横向滑动用于浏览完整手牌；范围划选保留给鼠标和触控笔。
    if (d.pointerType === 'touch') {
      if (Math.hypot(e.clientX - d.downX, e.clientY - d.downY) >= 8) d.moved = true;
      return;
    }
    if (!d.moved && Math.hypot(e.clientX - d.downX, e.clientY - d.downY) < 8) return;
    d.moved = true;
    const idx = idxAt(e, e.currentTarget);
    if (idx < 0) return;
    setDragging(true);
    const [lo, hi] = d.startIdx <= idx ? [d.startIdx, idx] : [idx, d.startIdx];
    onSetRange(hand.slice(lo, hi + 1).map(c => c.id), d.mode);
  };

  const handlePointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onToggle(hand[d.startIdx].id); // 无位移 → 视为单击
    setDragging(false);
  };

  const cancelDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return (
    <div
      className={`hand ${dragging ? 'dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
    >
      {hand.map(c => (
        <CardView key={c.id} card={c} selected={selected.has(c.id)} />
      ))}
    </div>
  );
}

export function CardFan({ cards }: { cards: Card[] }) {
  return (
    <div className="card-fan">
      {cards.map(c => (
        <CardView key={c.id} card={c} />
      ))}
    </div>
  );
}

export function CardBacks({ count }: { count: number }) {
  return (
    <div className="card-fan backs">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card face-down">
          <div className="card-back-pattern" />
        </div>
      ))}
    </div>
  );
}
