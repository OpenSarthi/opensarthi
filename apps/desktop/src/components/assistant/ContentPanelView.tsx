
interface ContentPanelViewProps {
  contentType: string | null;
  data: any | null;
}

export function ContentPanelView({ contentType, data }: ContentPanelViewProps) {
  if (!contentType || !data) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "11px", letterSpacing: "0.05em" }}>
          // NO ACTIVE CONTENT PANEL
        </p>
      </div>
    );
  }

  if (contentType === "briefing") {
    const { weather, news_headlines, calendar_events, memories } = data;
    const hasWeather = weather && Object.keys(weather).length > 0;
    const hasNews = news_headlines && news_headlines.length > 0;
    const hasCalendar = calendar_events && calendar_events.length > 0;
    const hasMemories = memories && memories.length > 0;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "8px", height: "100%", overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "11px" }} className="custom-scrollbar">
        {/* Weather */}
        {hasWeather && (
          <div style={{ padding: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px" }}>
            <div style={{ color: "var(--accent)", fontWeight: "bold", marginBottom: "4px" }}>☀️ WEATHER REPORT</div>
            <div style={{ color: "var(--text-secondary)" }}>
              {weather.temp ? `${weather.temp}°C` : ""}{weather.description ? ` - ${weather.description}` : ""}
              {weather.humidity ? ` | Humidity: ${weather.humidity}%` : ""}
              {weather.wind_speed ? ` | Wind: ${weather.wind_speed} wind` : ""}
            </div>
          </div>
        )}

        {/* Calendar */}
        {hasCalendar && (
          <div style={{ padding: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px" }}>
            <div style={{ color: "var(--accent)", fontWeight: "bold", marginBottom: "6px" }}>📅 UPCOMING SCHEDULE</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {calendar_events.map((evt: any, i: number) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "12px", borderBottom: "1px dashed rgba(255,255,255,0.03)", paddingBottom: "3px" }}>
                  <span style={{ color: "var(--text-primary)" }}>{evt.summary || evt.title}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", flexShrink: 0 }}>
                    {evt.start ? new Date(evt.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* News Headlines */}
        {hasNews && (
          <div style={{ padding: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px" }}>
            <div style={{ color: "var(--accent)", fontWeight: "bold", marginBottom: "6px" }}>📰 TOP NEWS HEADLINES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {news_headlines.map((item: any, i: number) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: "bold" }}>
                    {i + 1}. {item.title || item.summary}
                  </span>
                  {item.snippet && (
                    <span style={{ color: "var(--text-muted)", fontSize: "10px", lineHeight: "1.3", paddingLeft: "12px" }}>
                      {item.snippet}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Memories */}
        {hasMemories && (
          <div style={{ padding: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px" }}>
            <div style={{ color: "var(--accent)", fontWeight: "bold", marginBottom: "4px" }}>🧠 RECALLED MEMORIES</div>
            <ul style={{ margin: 0, paddingLeft: "16px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "3px" }}>
              {memories.map((m: any, i: number) => (
                <li key={i}>{m.content}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (contentType === "screen_analysis") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "8px", height: "100%", overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
        <div style={{ color: "var(--accent)", fontWeight: "bold", borderBottom: "1px solid var(--border)", paddingBottom: "4px" }}>
          🖥️ SCREEN ANALYSIS
        </div>
        <div style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: "1.5" }}>
          {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
        </div>
      </div>
    );
  }

  // Fallback for other content types
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "8px", height: "100%", overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
      <div style={{ color: "var(--accent)", fontWeight: "bold", textTransform: "uppercase" }}>
        {contentType}
      </div>
      <div style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
        {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
      </div>
    </div>
  );
}
