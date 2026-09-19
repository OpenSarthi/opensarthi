import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Mail,
  Twitter,
  MessageCircle,
  Zap,
  AtSign,
  Link2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Save,
  Eye,
  EyeOff,
  Settings as SettingsIcon,
} from "lucide-react";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";

interface IntegrationStatus {
  google_calendar: boolean;
  google_gmail: boolean;
  google_client_id?: string;
  google_client_secret_configured?: boolean;
  twitter: boolean;
  telegram: boolean;
  discord: boolean;
  smtp: boolean;
  linkedin: boolean;
}

interface IntegrationsPanelProps {
  runtimePort: number | null;
}

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.5)",
  border: "1px solid var(--border)",
  padding: "8px 12px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  outline: "none",
  borderRadius: "4px",
  width: "100%",
  boxSizing: "border-box" as const,
};

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--text-secondary)",
  letterSpacing: "0.06em",
  marginBottom: "4px",
  display: "block",
};

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "10px",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        color: connected ? "#22c55e" : "var(--text-muted)",
        background: connected ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${connected ? "rgba(34,197,94,0.3)" : "var(--border)"}`,
        padding: "2px 8px",
        borderRadius: "10px",
      }}
    >
      {connected ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

function SectionAccordion({
  icon,
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "6px",
        overflow: "hidden",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text-primary)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
          {icon} {title}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {badge}
          {open ? <ChevronDown size={13} opacity={0.5} /> : <ChevronRight size={13} opacity={0.5} />}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••"}
        style={{ ...inputStyle, paddingRight: "36px" }}
      />
      <button
        onClick={() => setShow((s) => !s)}
        style={{
          position: "absolute",
          right: "8px",
          top: "50%",
          transform: "translateY(-50%)",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          padding: "2px",
        }}
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );
}

export function IntegrationsPanel({ runtimePort }: IntegrationsPanelProps) {
  const [status, setStatus] = useState<IntegrationStatus>({
    google_calendar: false,
    google_gmail: false,
    twitter: false,
    telegram: false,
    discord: false,
    smtp: false,
    linkedin: false,
  });

  // Google OAuth Credentials
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [showGoogleConfig, setShowGoogleConfig] = useState(false);

  // Twitter
  const [twitterApiKey, setTwitterApiKey] = useState("");
  const [twitterApiSecret, setTwitterApiSecret] = useState("");
  const [twitterAccessToken, setTwitterAccessToken] = useState("");
  const [twitterAccessTokenSecret, setTwitterAccessTokenSecret] = useState("");

  // Telegram
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");

  // Discord
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");

  // SMTP Email
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");

  // LinkedIn
  const [linkedinToken, setLinkedinToken] = useState("");

  const [saving, setSaving] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const pollIntervalRef = useRef<any>(null);

  // Load current integration status from backend
  const fetchStatus = useCallback(async () => {
    if (!runtimePort) return;
    try {
      const res = await fetch(`http://127.0.0.1:${runtimePort}/integrations/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.google_client_id && !googleClientId) {
          setGoogleClientId(data.google_client_id);
        }
      }
    } catch {
      // Backend might not have this endpoint yet — silently ignore
    }
  }, [runtimePort, googleClientId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const showSaved = (msg: string) => {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(null), 2500);
  };

  const handleGoogleOAuth = async () => {
    if (!runtimePort) return;

    // If user modified client ID or secret, save them first
    if (googleClientId || googleClientSecret) {
      await saveSocial("google", {
        google_client_id: googleClientId,
        google_client_secret: googleClientSecret,
      });
    }

    const oauthUrl = `http://127.0.0.1:${runtimePort}/oauth/google/start`;

    // Try opening via Tauri shell plugin in system browser, with fallback to window.open
    try {
      await tauriOpen(oauthUrl);
    } catch (err) {
      console.warn("Tauri shell open failed, falling back to window.open", err);
      window.open(oauthUrl, "_blank");
    }

    // Auto-poll status every 2 seconds for 30 seconds to catch successful callback
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    let attempts = 0;
    pollIntervalRef.current = setInterval(async () => {
      attempts++;
      await fetchStatus();
      if (attempts > 15) {
        clearInterval(pollIntervalRef.current);
      }
    }, 2000);
  };

  const handleRevokeGoogle = async () => {
    if (!runtimePort) return;
    try {
      await fetch(`http://127.0.0.1:${runtimePort}/integrations/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integration: "google" }),
      });
      setStatus((s) => ({ ...s, google_calendar: false, google_gmail: false }));
      showSaved("Google authorization revoked");
    } catch { /* ignore */ }
  };

  const saveSocial = async (integration: string, data: Record<string, string>) => {
    if (!runtimePort) return;
    setSaving(integration);
    try {
      const res = await fetch(`http://127.0.0.1:${runtimePort}/integrations/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integration, ...data }),
      });
      if (res.ok) {
        if (integration !== "google") {
          setStatus((s) => ({ ...s, [integration]: true }));
        }
        showSaved(`${integration} credentials saved`);
        await fetchStatus();
      }
    } catch { /* ignore */ }
    setSaving(null);
  };

  const googleConnected = status.google_calendar && status.google_gmail;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* Saved toast */}
      <AnimatePresence>
        {savedMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              background: "rgba(34,197,94,0.15)",
              border: "1px solid rgba(34,197,94,0.4)",
              borderRadius: "6px",
              padding: "8px 12px",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              color: "#22c55e",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <CheckCircle2 size={12} /> {savedMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Google Workspace ── */}
      <SectionAccordion
        icon={<Mail size={13} />}
        title="GOOGLE WORKSPACE"
        badge={<StatusBadge connected={googleConnected} />}
        defaultOpen
      >
        <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
          Grant read-only access to Google Calendar and Gmail so OpenSarthi can check your schedule and emails.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <div style={{
            padding: "8px 10px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}>
            <Calendar size={12} />
            <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)" }}>Calendar</span>
            <StatusBadge connected={status.google_calendar} />
          </div>
          <div style={{
            padding: "8px 10px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}>
            <Mail size={12} />
            <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)" }}>Gmail</span>
            <StatusBadge connected={status.google_gmail} />
          </div>
        </div>

        {/* OAuth Credentials Configuration */}
        <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: "4px", padding: "8px 10px", background: "rgba(0,0,0,0.2)" }}>
          <button
            onClick={() => setShowGoogleConfig(!showGoogleConfig)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
              padding: 0,
              width: "100%",
              justifyContent: "space-between",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <SettingsIcon size={11} /> OAuth 2.0 Credentials (Client ID & Secret)
            </span>
            <span>{showGoogleConfig ? "Hide ▲" : "Configure ▼"}</span>
          </button>

          {showGoogleConfig && (
            <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div>
                <label style={labelStyle}>GOOGLE CLIENT ID</label>
                <input
                  type="text"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>GOOGLE CLIENT SECRET</label>
                <PasswordInput
                  value={googleClientSecret}
                  onChange={setGoogleClientSecret}
                  placeholder="e.g. GOCSPX-xxxxxxxxxxxx"
                />
              </div>
              <button
                disabled={saving === "google"}
                onClick={() => saveSocial("google", {
                  google_client_id: googleClientId,
                  google_client_secret: googleClientSecret,
                })}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                  padding: "7px", borderRadius: "4px", cursor: "pointer",
                  background: "rgba(var(--accent-rgb,255,59,48),0.1)", border: "1px solid var(--border-accent)",
                  color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.04em",
                }}
              >
                <Save size={10} /> {saving === "google" ? "Saving…" : "Save Google Credentials"}
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            id="google-oauth-btn"
            onClick={handleGoogleOAuth}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              padding: "9px",
              background: googleConnected ? "rgba(34,197,94,0.08)" : "rgba(var(--accent-rgb, 255,59,48),0.12)",
              border: `1px solid ${googleConnected ? "rgba(34,197,94,0.3)" : "var(--border-accent)"}`,
              borderRadius: "4px",
              cursor: "pointer",
              color: googleConnected ? "#22c55e" : "var(--accent)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              letterSpacing: "0.04em",
            }}
          >
            <ExternalLink size={11} />
            {googleConnected ? "Re-authorize in Browser" : "Authorize with Google"}
          </button>
          {googleConnected && (
            <button
              onClick={handleRevokeGoogle}
              style={{
                padding: "9px 12px",
                background: "rgba(255,59,48,0.08)",
                border: "1px solid rgba(255,59,48,0.3)",
                borderRadius: "4px",
                cursor: "pointer",
                color: "#ff3b30",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
              }}
            >
              Revoke
            </button>
          )}
        </div>

        <p style={{ fontSize: "10px", color: "var(--text-muted)", margin: 0 }}>
          Clicking Authorize opens Google's OAuth consent screen in your default browser.
        </p>
      </SectionAccordion>

      {/* ── Twitter / X ── */}
      <SectionAccordion
        icon={<Twitter size={13} />}
        title="TWITTER / X"
        badge={<StatusBadge connected={status.twitter} />}
      >
        <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
          Allows the agent to post tweets, reply, or delete. Requires a Twitter Developer App with Read+Write permission.
        </p>
        <div>
          <label style={labelStyle}>API KEY</label>
          <PasswordInput value={twitterApiKey} onChange={setTwitterApiKey} placeholder="Twitter API Key" />
        </div>
        <div>
          <label style={labelStyle}>API SECRET</label>
          <PasswordInput value={twitterApiSecret} onChange={setTwitterApiSecret} placeholder="Twitter API Secret" />
        </div>
        <div>
          <label style={labelStyle}>ACCESS TOKEN</label>
          <PasswordInput value={twitterAccessToken} onChange={setTwitterAccessToken} placeholder="Access Token" />
        </div>
        <div>
          <label style={labelStyle}>ACCESS TOKEN SECRET</label>
          <PasswordInput value={twitterAccessTokenSecret} onChange={setTwitterAccessTokenSecret} placeholder="Access Token Secret" />
        </div>
        <button
          id="twitter-save-btn"
          disabled={saving === "twitter"}
          onClick={() => saveSocial("twitter", {
            twitter_api_key: twitterApiKey,
            twitter_api_secret: twitterApiSecret,
            twitter_access_token: twitterAccessToken,
            twitter_access_token_secret: twitterAccessTokenSecret,
          })}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            padding: "9px", borderRadius: "4px", cursor: "pointer",
            background: "rgba(var(--accent-rgb,255,59,48),0.1)", border: "1px solid var(--border-accent)",
            color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.04em",
            opacity: saving === "twitter" ? 0.5 : 1,
          }}
        >
          <Save size={11} /> {saving === "twitter" ? "Saving…" : "Save Twitter Credentials"}
        </button>
      </SectionAccordion>

      {/* ── Telegram ── */}
      <SectionAccordion
        icon={<MessageCircle size={13} />}
        title="TELEGRAM"
        badge={<StatusBadge connected={status.telegram} />}
      >
        <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
          Enables sending messages to a Telegram bot channel. Create a bot via <code>@BotFather</code> and get the Chat ID.
        </p>
        <div>
          <label style={labelStyle}>BOT TOKEN</label>
          <PasswordInput value={telegramBotToken} onChange={setTelegramBotToken} placeholder="123456:ABC-DEF..." />
        </div>
        <div>
          <label style={labelStyle}>CHAT ID (or @channel)</label>
          <input
            type="text"
            value={telegramChatId}
            onChange={(e) => setTelegramChatId(e.target.value)}
            placeholder="@mychannel or -1001234567"
            style={inputStyle}
          />
        </div>
        <button
          id="telegram-save-btn"
          disabled={saving === "telegram"}
          onClick={() => saveSocial("telegram", {
            telegram_bot_token: telegramBotToken,
            telegram_chat_id: telegramChatId,
          })}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            padding: "9px", borderRadius: "4px", cursor: "pointer",
            background: "rgba(var(--accent-rgb,255,59,48),0.1)", border: "1px solid var(--border-accent)",
            color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.04em",
            opacity: saving === "telegram" ? 0.5 : 1,
          }}
        >
          <Save size={11} /> {saving === "telegram" ? "Saving…" : "Save Telegram Credentials"}
        </button>
      </SectionAccordion>

      {/* ── Discord ── */}
      <SectionAccordion
        icon={<Zap size={13} />}
        title="DISCORD"
        badge={<StatusBadge connected={status.discord} />}
      >
        <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
          Sends messages to a Discord channel via a Webhook URL. Go to your channel settings → Integrations → Webhooks.
        </p>
        <div>
          <label style={labelStyle}>WEBHOOK URL</label>
          <PasswordInput value={discordWebhookUrl} onChange={setDiscordWebhookUrl} placeholder="https://discord.com/api/webhooks/..." />
        </div>
        <button
          id="discord-save-btn"
          disabled={saving === "discord"}
          onClick={() => saveSocial("discord", { discord_webhook_url: discordWebhookUrl })}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            padding: "9px", borderRadius: "4px", cursor: "pointer",
            background: "rgba(var(--accent-rgb,255,59,48),0.1)", border: "1px solid var(--border-accent)",
            color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.04em",
            opacity: saving === "discord" ? 0.5 : 1,
          }}
        >
          <Save size={11} /> {saving === "discord" ? "Saving…" : "Save Discord Webhook"}
        </button>
      </SectionAccordion>

      {/* ── Email (SMTP) ── */}
      <SectionAccordion
        icon={<AtSign size={13} />}
        title="EMAIL (SMTP)"
        badge={<StatusBadge connected={status.smtp} />}
      >
        <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
          Send emails on your behalf via SMTP. Use Gmail with App Passwords, Outlook, or any SMTP server.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px" }}>
          <div>
            <label style={labelStyle}>SMTP HOST</label>
            <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" style={inputStyle} />
          </div>
          <div style={{ width: "70px" }}>
            <label style={labelStyle}>PORT</label>
            <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" style={inputStyle} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>USERNAME / EMAIL</label>
          <input type="text" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="you@gmail.com" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>PASSWORD / APP PASSWORD</label>
          <PasswordInput value={smtpPassword} onChange={setSmtpPassword} placeholder="App password" />
        </div>
        <button
          id="smtp-save-btn"
          disabled={saving === "smtp"}
          onClick={() => saveSocial("smtp", { smtp_host: smtpHost, smtp_port: smtpPort, smtp_user: smtpUser, smtp_password: smtpPassword })}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            padding: "9px", borderRadius: "4px", cursor: "pointer",
            background: "rgba(var(--accent-rgb,255,59,48),0.1)", border: "1px solid var(--border-accent)",
            color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.04em",
            opacity: saving === "smtp" ? 0.5 : 1,
          }}
        >
          <Save size={11} /> {saving === "smtp" ? "Saving…" : "Save SMTP Settings"}
        </button>
      </SectionAccordion>

      {/* ── LinkedIn ── */}
      <SectionAccordion
        icon={<Link2 size={13} />}
        title="LINKEDIN"
        badge={<StatusBadge connected={status.linkedin} />}
      >
        <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
          Post to LinkedIn using a personal access token. Generate one from the LinkedIn Developer Portal.
        </p>
        <div>
          <label style={labelStyle}>ACCESS TOKEN</label>
          <PasswordInput value={linkedinToken} onChange={setLinkedinToken} placeholder="LinkedIn access token" />
        </div>
        <button
          id="linkedin-save-btn"
          disabled={saving === "linkedin"}
          onClick={() => saveSocial("linkedin", { linkedin_access_token: linkedinToken })}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            padding: "9px", borderRadius: "4px", cursor: "pointer",
            background: "rgba(var(--accent-rgb,255,59,48),0.1)", border: "1px solid var(--border-accent)",
            color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.04em",
            opacity: saving === "linkedin" ? 0.5 : 1,
          }}
        >
          <Save size={11} /> {saving === "linkedin" ? "Saving…" : "Save LinkedIn Token"}
        </button>
      </SectionAccordion>
    </div>
  );
}
