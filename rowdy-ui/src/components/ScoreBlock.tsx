interface ScoreBlockProps {
  final: number;
  proj?: number;
  color?: string;
  small?: boolean;
  projLeft?: boolean;
}

export default function ScoreBlock({ final, proj = 0, color, small = false, projLeft = false }: ScoreBlockProps) {
  const projSpan = proj > 0 && (
    <span
      style={{
        fontSize: small ? "0.35em" : "0.5em",
        color: "#aaa",
        marginLeft: projLeft ? 0 : (small ? 3 : 4),
        marginRight: projLeft ? (small ? 3 : 4) : 0,
        verticalAlign: "middle",
        fontWeight: 400
      }}
    >
      (+{proj})
    </span>
  );

  return (
    <span>
      {projLeft && projSpan}
      <span style={{ color: color || "inherit" }}>{final}</span>
      {!projLeft && projSpan}
    </span>
  );
}
