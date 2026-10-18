export interface PhraseWheelItem {
  phrase: string;
  x: number;
  y: number;
  selected: boolean;
}

export interface WheelPoint {
  x: number;
  y: number;
}

const WHEEL_EDGE_INSET = 96;

export function wheelOrigin(point: WheelPoint, viewport: { width: number; height: number }): WheelPoint {
  const clamp = (value: number, extent: number) => Math.min(Math.max(value, WHEEL_EDGE_INSET), Math.max(WHEEL_EDGE_INSET, extent - WHEEL_EDGE_INSET));
  return { x: clamp(point.x, viewport.width), y: clamp(point.y, viewport.height) };
}

export function phraseWheelItems(phrases: string[], selectedIndex: number | null, radius: number): PhraseWheelItem[] {
  return phrases.map((phrase, index) => {
    const angle = (index / phrases.length) * Math.PI * 2;
    const x = Math.round(Math.sin(angle) * radius);
    const y = Math.round(-Math.cos(angle) * radius);
    return {
      phrase,
      x: x === 0 ? 0 : x,
      y: y === 0 ? 0 : y,
      selected: index === selectedIndex,
    };
  });
}
