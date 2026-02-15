import { type ReactNode } from "react";
import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import AuthButton from "../AuthButton";
import ProgressSummary from "./ProgressSummary";
import SidebarSection from "./SidebarSection";
import type { MetricUnit } from "../../utils/units";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useUIState } from "../../contexts/UIStateContext";

interface SidebarProps {
  estimatedYearEnd: number;
  /** Current cumulative value (distance in miles/km, or session count) */
  currentValue: number;
  unit?: MetricUnit;
  isLoading?: boolean;
  // Slots for composed content
  filtersSlot: ReactNode;
  goalsSlot: ReactNode;
  // Whether to show auth button on mobile (false for demo mode)
  showAuthButton?: boolean;
}

interface SidebarSections {
  filters: boolean;
  goals: boolean;
}

const CloseIcon = () => (
  <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
    <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
  </svg>
);

export default function Sidebar({
  estimatedYearEnd,
  currentValue,
  unit = "miles",
  isLoading = false,
  filtersSlot,
  goalsSlot,
  showAuthButton = true,
}: SidebarProps) {
  const [expandedSections, setExpandedSections] = useLocalStorage<SidebarSections>(
    "sidebar-sections",
    { filters: true, goals: true }
  );
  const { mobileSidebarOpen: mobileOpen, closeMobileSidebar } = useUIState();

  const toggleSection = (section: keyof SidebarSections) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section],
    });
  };

  const sidebarContent = (
    <>
      <ProgressSummary
        currentValue={currentValue}
        estimatedYearEnd={estimatedYearEnd}
        unit={unit}
        isLoading={isLoading}
      />

      <hr className="my-2" />

      <SidebarSection
        title="Filters"
        id="filters"
        isExpanded={expandedSections.filters}
        onToggle={() => toggleSection("filters")}
      >
        {filtersSlot}
      </SidebarSection>

      <hr className="my-2" />

      <SidebarSection
        title="Goals"
        id="goals"
        isExpanded={expandedSections.goals}
        onToggle={() => toggleSection("goals")}
      >
        {goalsSlot}
      </SidebarSection>

      {showAuthButton && (
        <div className="md:hidden mt-auto px-4 py-4 border-t">
          <AuthButton signOutVariant="outline-secondary" />
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Desktop: sticky sidebar */}
      <div className="sidebar glass-panel-flush hidden md:block md:w-60 shrink-0">
        <div className="flex flex-col p-0 pt-4 overflow-y-auto h-full">{sidebarContent}</div>
      </div>

      {/* Mobile: slide-out drawer */}
      <Transition show={mobileOpen}>
        <Dialog
          onClose={() => closeMobileSidebar()}
          className="relative md:hidden"
          style={{ zIndex: 50 }}
        >
          <TransitionChild
            enter="transition-opacity duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
          </TransitionChild>

          <TransitionChild
            enter="transition-transform duration-200"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition-transform duration-150"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
          >
            <DialogPanel
              className="fixed inset-y-0 left-0 flex flex-col overflow-y-auto"
              style={{
                backgroundColor: "var(--color-bg-body)",
                maxWidth: "300px",
                width: "85vw",
              }}
            >
              <div className="flex items-center justify-between p-4">
                <h5 className="text-white m-0">Controls</h5>
                <button
                  type="button"
                  className="bg-transparent border-0 text-white p-1"
                  onClick={() => closeMobileSidebar()}
                  aria-label="Close"
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="flex flex-col grow p-4 overflow-y-auto">{sidebarContent}</div>
            </DialogPanel>
          </TransitionChild>
        </Dialog>
      </Transition>
    </>
  );
}
