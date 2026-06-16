import { motion } from "framer-motion";

interface SplashScreenProps {
  isConnected: boolean;
}

export function SplashScreen({ isConnected }: SplashScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.5 }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "radial-gradient(ellipse at 30% 40%, hsl(0,0%,5%) 0%, hsl(0,0%,2%) 100%)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 32,
      }}
    >
      {/* Glow behind icon */}
      <div style={{
        position: "absolute", width: 300, height: 300, borderRadius: "50%",
        background: "radial-gradient(circle, hsla(0,80%,40%,0.15) 0%, transparent 70%)",
        filter: "blur(40px)",
      }} />

      {/* Icon */}
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 18 }}
        style={{ position: "relative" }}
      >
        <img
          src="/icon.png"
          alt="OpenSarthi"
          style={{ width: 100, height: 100, borderRadius: 24, boxShadow: "0 0 40px hsla(0,80%,50%,0.3)" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </motion.div>

      {/* Title */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        style={{ textAlign: "center" }}
      >
        <div style={{
          fontSize: 28, fontWeight: 900, letterSpacing: "0.12em",
          color: "var(--accent)", fontFamily: "var(--font-mono)",
        }}>
          OPENSARTHI
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: "0.2em", marginTop: 6 }}>
          AI DESKTOP AGENT · ANDROID
        </div>
      </motion.div>

      {/* Loading indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ opacity: [0.3, 1, 0.3], scaleY: [0.5, 1, 0.5] }}
              transition={{ duration: 1, delay: i * 0.2, repeat: Infinity }}
              style={{
                width: 4, height: 20, borderRadius: 2,
                background: "var(--accent)", transformOrigin: "center",
              }}
            />
          ))}
        </div>
        <div style={{
          fontSize: 10, color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)", letterSpacing: "0.15em",
        }}>
          {isConnected ? "READY" : "STARTING RUNTIME..."}
        </div>
      </motion.div>
    </motion.div>
  );
}
