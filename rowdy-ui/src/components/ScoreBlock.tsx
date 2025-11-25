interface ScoreBlockProps {
  final: number;
  proj?: number;
  color?: string;
  small?: boolean;
}

export default function ScoreBlock({ final, proj = 0, color, small = false }: ScoreBlockProps) {
  return (
    <span>
      <span style={{ color: color || "inherit" }}>{final}</span>
      {proj > 0 && (
        <span
          style={{
            fontSize: small ? "0.35em" : "0.5em",
            color: "#aaa",
            marginLeft: small ? 3 : 4,
            verticalAlign: "middle",
            fontWeight: 400
          }}
        >
          (+{proj})
        </span>
      )}
    </span>
  );
}
