import { type ReactNode } from "react";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import AuthButton from "../AuthButton";
import ProgressSummary from "./ProgressSummary";
import SidebarSection from "./SidebarSection";
import type { MetricUnit } from "../../utils/units";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { CloseIconLg } from "../icons";
import { useUIState } from "../../contexts/UIStateContext";

interface SidebarProps {
  estimatedYearEnd: number;
  /** Current cumulative value (distance in miles/km, or session count) */
  currentValue: number;
  unit?: MetricUnit | undefined;
  isLoading?: boolean | undefined;
  // Slots for composed content
  filtersSlot: ReactNode;
  goalsSlot: ReactNode;
  // Whether to show auth button on mobile (false for demo mode)
  showAuthButton?: boolean | undefined;
}

interface SidebarSections {
  filters: boolean;
  goals: boolean;
}

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
          <AuthButton />
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
      <Sheet open={mobileOpen} onOpenChange={(open) => !open && closeMobileSidebar()}>
        <SheetContent side="left" className="max-w-[300px] w-[85vw] md:hidden">
          <div className="flex items-center justify-between p-4">
            <SheetTitle className="text-white m-0">Controls</SheetTitle>
            <SheetClose className="bg-transparent border-0 text-white p-1" aria-label="Close">
              <CloseIconLg />
            </SheetClose>
          </div>
          <div className="flex flex-col grow p-4 overflow-y-auto">{sidebarContent}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
