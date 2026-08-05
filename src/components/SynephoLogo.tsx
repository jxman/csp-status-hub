interface Props {
  height: number;
  className?: string;
}

export function SynephoLogo({ height, className }: Props) {
  return (
    <span className={className} style={{ display: 'inline-flex', height, verticalAlign: 'middle' }}>
      <img
        src="/logos/synepho-light.png"
        alt="Synepho"
        height={height}
        style={{ height, width: 'auto' }}
        className="synepho-logo-light"
      />
      <img
        src="/logos/synepho-dark.png"
        alt="Synepho"
        height={height}
        style={{ height, width: 'auto' }}
        className="synepho-logo-dark"
      />
    </span>
  );
}
