interface ScoreBlockProps {
  final: number;
  proj?: number;
  color?: string;
}

export default function ScoreBlock({ final, proj = 0, color }: ScoreBlockProps) {
  return (
    <span>
      <span style={{ color: color || "inherit" }}>{final}</span>
      {proj > 0 && (
        <span
          style={{
            fontSize: "0.5em",
            color: "#aaa",
            marginLeft: 4,
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
