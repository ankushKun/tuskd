import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: React.ReactNode; title?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              backdropFilter: "blur(6px)",
              zIndex: 100,
            }}
          />
          <motion.div
            key="sheet-panel"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              background: "var(--bg-panel)",
              borderTop: "1px solid var(--border)",
              borderTopLeftRadius: "var(--radius-lg)",
              borderTopRightRadius: "var(--radius-lg)",
              zIndex: 101,
              maxHeight: "85vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 0",
              }}
            >
              {title ? (
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)" }}>{title}</h3>
              ) : (
                <div />
              )}
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
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: "20px 24px 40px" }}>{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
