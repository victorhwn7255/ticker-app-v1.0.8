import { cn } from '@/lib/cn';
import { AVATAR_STYLE, type Kind } from '@/lib/kinds';
import { ThemeIcon } from './Icons';

/**
 * Kind-keyed monogram tile. Company/chokepoint show a ticker/code monogram;
 * theme shows the nodes glyph. 2px border, 0 radius, mono 700. Decorative
 * (`aria-hidden`) - the adjacent handle carries the identity.
 */
function monoFont(size: number): number {
  if (size <= 24) return 8;
  if (size <= 32) return 9;
  if (size <= 40) return 11;
  if (size <= 44) return 12;
  if (size <= 56) return 14;
  if (size <= 64) return 15;
  if (size <= 72) return 17;
  if (size <= 80) return 20;
  return Math.round(size * 0.25);
}

// The theme nodes glyph tracks the wireframe at the reference sizes (40 -> 19,
// 42 -> 20, 56 -> 26); other sizes scale proportionally.
function glyphSize(size: number): number {
  if (size === 40) return 19;
  if (size === 42) return 20;
  if (size === 56) return 26;
  return Math.round(size * 0.46);
}

export function Avatar({
  kind,
  text,
  size = 42,
  rounded = false,
  className,
}: {
  kind: Kind;
  text?: string;
  size?: number;
  /** X-style: circular, hairline ring instead of the hard 2px border. */
  rounded?: boolean;
  className?: string;
}) {
  const style = AVATAR_STYLE[kind];
  const showGlyph = kind === 'theme' && !text;

  return (
    <span
      className={cn(
        'inline-flex flex-none items-center justify-center font-mono font-bold',
        rounded ? 'rounded-full ring-1 ring-line' : 'border',
        style.bg,
        style.color,
        className,
      )}
      style={{ width: size, height: size, fontSize: showGlyph ? undefined : monoFont(size) }}
      aria-hidden="true"
    >
      {showGlyph ? <ThemeIcon size={glyphSize(size)} /> : text}
    </span>
  );
}
