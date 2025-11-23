// src/App.tsx
import { Link } from "react-router-dom";

export default function App() {
  return (
    <div style={{ padding: 16 }}>
      <h1>Rowdy PWA</h1>
      <p><Link to="/match/2025ChristmasClassicR01M01">Open a match</Link></p>
    </div>
  );
}