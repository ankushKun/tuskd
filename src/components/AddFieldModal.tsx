import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquareText, Settings2, Check, Star, Image, FileVideo, Link } from "lucide-react";
import type { FieldType } from "../types";

export const fieldTypeOptions: Array<{ type: FieldType; label: string; icon: React.ElementType; description: string }> = [
  { type: "shortText", label: "Short text", icon: MessageSquareText, description: "Single-line input for names, titles, or short answers." },
  { type: "richText", label: "Rich text", icon: MessageSquareText, description: "Multi-line textarea for detailed feedback or notes." },
  { type: "dropdown", label: "Dropdown", icon: Settings2, description: "Single-choice select menu with customizable options." },
  { type: "checkboxes", label: "Checkboxes", icon: Check, description: "Multi-choice selection with checkable options." },
  { type: "rating", label: "Star rating", icon: Star, description: "1-to-5 star score input for ratings and reviews." },
  { type: "image", label: "Screenshot", icon: Image, description: "Accept image uploads via Walrus decentralized storage." },
  { type: "video", label: "Video upload", icon: FileVideo, description: "Accept video uploads via Walrus decentralized storage." },
  { type: "url", label: "URL", icon: Link, description: "Validated http or https link input field." },
];

export function AddFieldModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (type: FieldType) => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(10px)",
              zIndex: 100,
            }}
          />
          <motion.div
            key="modal-panel"
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ type: "spring", damping: 24, stiffness: 320 }}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "0 25px 60px -12px var(--shadow-color)",
              zIndex: 101,
              width: "min(520px, 92vw)",
              maxHeight: "85vh",
              overflowY: "auto",
              padding: "28px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--fg)" }}>Add Question</h2>
                <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--fg-muted)" }}>Choose a field type to add to your form.</p>
              </div>
              <button
                onClick={onClose}
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 36,
                  height: 36,
                  borderRadius: "var(--radius-full)",
                  border: "none",
                  background: "var(--bg-muted)",
                  color: "var(--fg-muted)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              {fieldTypeOptions.map((item) => (
                <button
                  key={item.type}
                  onClick={() => { onSelect(item.type); onClose(); }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "18px 16px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--fg)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--primary)";
                    e.currentTarget.style.background = "var(--bg-accent)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px var(--shadow-color)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--bg-panel)";
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <item.icon size={22} style={{ color: "var(--primary)" }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.4 }}>{item.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
