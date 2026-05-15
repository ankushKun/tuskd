import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function DropdownPortal({ children }: { children: React.ReactNode }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  if (!elRef.current) {
    elRef.current = document.createElement("div");
    elRef.current.style.position = "fixed";
    elRef.current.style.top = "0";
    elRef.current.style.left = "0";
    elRef.current.style.width = "100%";
    elRef.current.style.height = "100%";
    elRef.current.style.pointerEvents = "none";
    elRef.current.style.zIndex = "9999";
  }
  useEffect(() => {
    document.body.appendChild(elRef.current!);
    return () => {
      document.body.removeChild(elRef.current!);
    };
  }, []);
  return createPortal(children, elRef.current);
}
