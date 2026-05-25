interface IconProps {
  name: string;
  size?: number;
  filled?: boolean;
  className?: string;
  'aria-hidden'?: boolean;
}

/** Material Symbols icon rendered via Google Fonts. */
export function Icon({ name, size = 20, filled = false, className, 'aria-hidden': ariaHidden }: IconProps) {
  return (
    <span
      className={className ?? 'agenthub-icon'}
      aria-hidden={ariaHidden ?? true}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        fontSize: size,
        lineHeight: 1,
        fontFamily: '"Material Symbols Outlined"',
        fontVariationSettings: `"FILL" ${filled ? 1 : 0}, "wght" 500, "GRAD" 0, "opsz" 24`,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {name}
    </span>
  );
}
