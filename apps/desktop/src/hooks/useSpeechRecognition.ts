import { useEffect, useRef, useCallback } from "react";
import { useAssistantStore } from "../stores/assistantStore";
import { wsClient } from "../lib/ws";

// Extend window interface for SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export function useSpeechRecognition() {
  const { setVoiceState, setTranscript, addMessage } = useAssistantStore();
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);

  const startListening = useCallback(() => {
    if (isListeningRef.current || !recognitionRef.current) return;
    
    try {
      recognitionRef.current.start();
      isListeningRef.current = true;
      setVoiceState("listening");
      wsClient.send("session_state", { active: true });
    } catch (e) {
      console.error("Speech recognition error:", e);
    }
  }, [setVoiceState]);

  const stopListening = useCallback(() => {
    if (!isListeningRef.current || !recognitionRef.current) return;
    
    try {
      recognitionRef.current.stop();
      isListeningRef.current = false;
      setVoiceState("idle");
      wsClient.send("session_state", { active: false });
    } catch (e) {
      console.error("Speech recognition error:", e);
    }
  }, [setVoiceState]);

  useEffect(() => {
    // Check support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition API not supported in this environment.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN'; // English India as requested
    
    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const currentText = finalTranscript || interimTranscript;
      setTranscript(currentText);

      // Wake word detection
      const textLower = currentText.toLowerCase();
      if (textLower.includes("hey sarthi") || textLower.includes("hello sarthi")) {
        // Wake word detected, could trigger a sound or UI change
        console.log("WAKE WORD DETECTED");
      }

      // If final, send as user message
      if (finalTranscript) {
        const { wakeWords } = useAssistantStore.getState();
        const escapedWakeWords = wakeWords.map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const hasSarthi = wakeWords.some((w: string) => w.toLowerCase().includes("sarthi") || w.toLowerCase().includes("sarathi"));
        if (hasSarthi) {
          escapedWakeWords.push("sanati", "farati", "sarath", "sarth", "sorthi", "sorathi", "sorth", "sharthi", "sharathi", "sharth", "sarty", "sarathy", "sarti", "sarathi", "sarthii", "sarathii");
        }
        escapedWakeWords.sort((a, b) => b.length - a.length);

        const wakeWordRegexFull = new RegExp(`^(?:.*?)(?:hey|hello|hi|he)?\\s*(?:${escapedWakeWords.join('|')})`, 'i');
        const cleanText = finalTranscript
          .replace(wakeWordRegexFull, "")
          .replace(/^[\s,;:.!?]+/, "")
          .replace(/[\s,;:.!?]+$/, "")
          .trim();
          
        if (cleanText) {
          addMessage({ id: crypto.randomUUID(), role: "user", content: cleanText, timestamp: Date.now() });
          wsClient.send("user_message", { text: cleanText, source: "voice" });
          setVoiceState("processing");
          // Optionally stop listening after sending
          // stopListening();
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === 'not-allowed') {
        setVoiceState("error");
      }
    };

    recognition.onend = () => {
      // If we are still supposed to be listening (e.g. continuous wake word), restart
      if (isListeningRef.current) {
        try {
          recognition.start();
        } catch (e) {
          // Ignore "already started" errors
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [setTranscript, setVoiceState]);

  return {
    startListening,
    stopListening,
    isSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  };
}
