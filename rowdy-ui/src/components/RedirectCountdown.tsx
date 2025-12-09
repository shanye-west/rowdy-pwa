import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface RedirectCountdownProps {
  message: string;
  seconds?: number;
  to?: string;
}

export default function RedirectCountdown({ message, seconds = 3, to = "/" }: RedirectCountdownProps) {
  const [count, setCount] = useState(seconds);
  const navigate = useNavigate();

  useEffect(() => {
    const interval = setInterval(() => {
      setCount(c => Math.max(0, c - 1));
    }, 1000);

    const timer = setTimeout(() => {
      navigate(to);
    }, seconds * 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [seconds, navigate, to]);

  return (
    <div className="empty-state">
      <div className="empty-state-icon">🔍</div>
      <div className="empty-state-text">{message}</div>
      <div style={{ marginTop: 8, color: "#64748b" }}>
        Redirecting home in {count}
      </div>
    </div>
  );
}
