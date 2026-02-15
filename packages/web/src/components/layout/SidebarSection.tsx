import type { ReactNode } from "react";

interface SidebarSectionProps {
  /** Section title displayed in the header */
  title: string;
  /** Unique ID for aria attributes */
  id: string;
  /** Whether the section is currently expanded */
  isExpanded: boolean;
  /** Callback when section is toggled */
  onToggle: () => void;
  /** Content to display when expanded */
  children: ReactNode;
}

/**
 * Collapsible sidebar section with accessible header button.
 * Parent component manages expanded state (allows localStorage persistence).
 */
export default function SidebarSection({
  title,
  id,
  isExpanded,
  onToggle,
  children,
}: SidebarSectionProps) {
  return (
    <>
      <button
        className="sidebar-heading px-6 py-3 mb-0 text-slate-light uppercase flex items-center justify-between w-full bg-transparent border-0 min-h-[44px]"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`${id}-collapse`}
        style={{ cursor: "pointer" }}
      >
        <span className="font-semibold" style={{ fontSize: "0.75rem", letterSpacing: "0.05em" }}>
          {title}
        </span>
        <span style={{ fontSize: "0.65rem", transition: "transform 0.2s" }}>
          {isExpanded ? "▲" : "▼"}
        </span>
      </button>

      <div id={`${id}-collapse`} className={isExpanded ? "block" : "hidden"}>
        <div className="px-6 py-6">{children}</div>
      </div>
    </>
  );
}
