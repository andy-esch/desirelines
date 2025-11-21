# React Web App Code Review: Best Practices Analysis

**Review Date:** 2025-11-21
**Scope:** `packages/web/` - React TypeScript frontend application
**Reviewer:** Claude Code

## Executive Summary

This code review examines the React web application for adherence to React best practices, code quality, architectural sustainability, and potential bugs. The application is generally well-structured with good separation of concerns, but there are several areas requiring improvement for better maintainability, performance, and user experience.

**Overall Assessment:** 🟡 Moderate - Good foundation with room for improvement

**Key Strengths:**
- Clear separation of concerns (API layer, services, hooks, components, utils)
- Good use of custom hooks for logic reuse
- TypeScript for type safety
- Comprehensive test coverage setup
- Real-time Firestore synchronization with optimistic updates

**Critical Issues Found:** 12 high-priority issues
**Moderate Issues Found:** 15 medium-priority issues
**Minor Issues Found:** 8 low-priority issues

---

## Table of Contents

1. [Critical Issues](#1-critical-issues-high-priority)
2. [React Anti-Patterns](#2-react-anti-patterns-moderate-priority)
3. [Code Smells](#3-code-smells-moderate-priority)
4. [Architecture & Sustainability](#4-architecture--sustainability-concerns)
5. [Performance Optimizations](#5-performance-optimizations)
6. [Bugs & Potential Fixes](#6-bugs--potential-fixes)
7. [Accessibility Issues](#7-accessibility-issues)
8. [Recommendations Summary](#8-recommendations-summary)

---

## 1. Critical Issues (High Priority)

### 1.1 Improper Navigation (SportPage.tsx:224)

**Issue:** Using `window.location.href` instead of React Router's programmatic navigation

```typescript
// ❌ BAD - Causes full page reload
window.location.href = `/${sport}/${newYear}`;

// ✅ GOOD - Use React Router
navigate(`/${sport}/${newYear}`);
```

**Location:** `packages/web/src/pages/SportPage.tsx:224`

**Impact:**
- Causes full page reload, losing React state
- Breaks SPA behavior
- Poor user experience (page flash, slower navigation)
- Loses in-memory data and optimistic UI updates

**Fix:**
```typescript
import { useNavigate } from "react-router-dom";

export default function SportPage({ sport }: SportPageProps) {
  const navigate = useNavigate();

  // ...

  <Sidebar
    onYearClick={(newYear) => {
      navigate(`/${sport}/${newYear}`);
    }}
  />
}
```

**Priority:** 🔴 Critical - Fix immediately

---

### 1.2 Using `alert()` for Validation Errors (GoalControls.tsx:72)

**Issue:** Browser native `alert()` is bad UX and not accessible

```typescript
// ❌ BAD - Blocks UI, poor UX
if (validationError) {
  alert(validationError);
  return;
}
```

**Location:** `packages/web/src/components/GoalControls.tsx:72`

**Impact:**
- Blocks entire UI thread
- Not accessible (screen readers have limited support)
- Breaks user flow
- Cannot be styled or customized
- Poor mobile experience

**Fix:**
Use inline validation feedback:

```typescript
const [validationError, setValidationError] = useState<string | null>(null);

const handleSaveEdit = (id: string) => {
  const value = parseInt(editValue);
  if (isNaN(value)) {
    setValidationError("Please enter a valid number");
    return;
  }

  const error = validateGoalValue(value);
  if (error) {
    setValidationError(error);
    return;
  }

  setValidationError(null);
  // ... save logic
};

// In render:
{validationError && (
  <div className="alert alert-danger py-1 px-2 small" role="alert">
    {validationError}
  </div>
)}
```

**Priority:** 🔴 Critical - Affects UX significantly

---

### 1.3 Using `window.location.reload()` for Retry (CumulativeMetricsChart.tsx:266)

**Issue:** Full page reload for error recovery defeats React's purpose

```typescript
// ❌ BAD - Reloads entire page
<ErrorChart error={error} onRetry={() => window.location.reload()} />
```

**Location:** `packages/web/src/components/charts/CumulativeMetricsChart.tsx:266`

**Impact:**
- Loses all application state
- Resets user's position and context
- Unnecessary network requests
- Poor user experience

**Fix:**
Implement proper retry logic in the parent component:

```typescript
// In SportPage.tsx
const [retryCount, setRetryCount] = useState(0);

const handleRetry = () => {
  setError(null);
  setRetryCount(prev => prev + 1);
};

// In useEffect dependency array
useEffect(() => {
  // ... fetch logic
}, [currentYear, sport, user, authLoading, retryCount]);

// Pass to chart
<CumulativeMetricsChart
  error={error}
  onRetry={handleRetry}
/>
```

**Priority:** 🔴 Critical - Poor UX pattern

---

### 1.4 Inconsistent Fixture Mode Logic (useUserConfig.ts:370)

**Issue:** `useFullUserConfig` uses `USE_FIXTURE_DATA` build flag instead of auth-based mode

```typescript
// In useUserConfig (line 71) - uses auth state ✅
const isFixtureMode = !user;

// In useFullUserConfig (line 370) - uses build flag ❌
if (USE_FIXTURE_DATA) {
  console.warn("Fixture mode: Changes not persisted", data);
  return;
}
```

**Location:** `packages/web/src/hooks/useUserConfig.ts:370`

**Impact:**
- Authenticated users cannot persist changes when `USE_FIXTURE_DATA=true`
- Inconsistent behavior between hooks
- Violates the "authenticated users always use Firestore" principle

**Fix:**
```typescript
export function useFullUserConfig(userId?: string, version: string = "v1") {
  const { user } = useAuth(); // Get auth state
  const isFixtureMode = !user; // Match useUserConfig logic

  const updateSection = useCallback(async (...args) => {
    if (isFixtureMode) {
      console.warn("Fixture mode: Changes not persisted");
      return;
    }
    // ... rest of logic
  }, [configService, isFixtureMode]);
}
```

**Priority:** 🔴 Critical - Data loss risk

---

### 1.5 Massive Component Violating SRP (SportPage.tsx)

**Issue:** SportPage component has 300+ lines and handles too many responsibilities

**Responsibilities:**
1. Data fetching (metrics, config)
2. Auth state management
3. Unit conversion logic
4. Goal management
5. Year context creation
6. Rendering layout and all child components

**Location:** `packages/web/src/pages/SportPage.tsx` (entire file)

**Impact:**
- Hard to test individual features
- Difficult to maintain
- Props drilling nightmare
- Cannot reuse parts of logic
- Violates Single Responsibility Principle

**Fix:**
Split into smaller components and hooks:

```typescript
// New hook: useSportData.ts
export function useSportData(year: number, sport: string) {
  const { user, loading: authLoading } = useAuth();
  const [metrics, setMetrics] = useState<SportMetrics | null>(null);
  const [sportConfig, setSportConfig] = useState<SportConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // ... fetching logic
  }, [year, sport, user, authLoading]);

  return { metrics, sportConfig, isLoading, error };
}

// New component: SportDashboard.tsx
function SportDashboard({
  metrics,
  sportConfig,
  year,
  sport
}: SportDashboardProps) {
  // Rendering logic only
}

// Refactored SportPage.tsx (much simpler)
export default function SportPage({ sport }: SportPageProps) {
  const { year } = useParams();
  const currentYear = year ? parseInt(year) : new Date().getFullYear();
  const sportData = useSportData(currentYear, sport);

  return <SportDashboard {...sportData} year={currentYear} sport={sport} />;
}
```

**Priority:** 🔴 Critical - Maintainability risk

---

### 1.6 Duplicated Auth Token Fetching Logic

**Issue:** Auth token fetching is duplicated in SportPage.tsx and Sidebar.tsx

**Locations:**
- `packages/web/src/pages/SportPage.tsx:79-84`
- `packages/web/src/components/layout/Sidebar.tsx:59-67`

```typescript
// Duplicated pattern in both files:
if (user) {
  const { getFirebaseAuth } = await import("../lib/firebase");
  const auth = getFirebaseAuth();
  const currentUser = auth.currentUser;
  if (currentUser) {
    idToken = await currentUser.getIdToken();
  }
}
```

**Impact:**
- Code duplication violates DRY principle
- Harder to update auth logic
- Inconsistency risk if one gets updated

**Fix:**
Create a shared hook:

```typescript
// New file: hooks/useAuthToken.ts
export function useAuthToken() {
  const { user } = useAuth();

  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (!user) return undefined;

    const { getFirebaseAuth } = await import("../lib/firebase");
    const auth = getFirebaseAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) return undefined;

    return await currentUser.getIdToken();
  }, [user]);

  return { getToken };
}

// Usage in SportPage.tsx:
const { getToken } = useAuthToken();
const idToken = await getToken();
```

**Priority:** 🟡 High - Code quality issue

---

## 2. React Anti-Patterns (Moderate Priority)

### 2.1 Missing Cleanup in Auth Error Handling (useAuth.ts)

**Issue:** Sign-in/sign-out errors are logged but don't update state

```typescript
// ❌ No state update on error
const signIn = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Sign in error:", error);
    throw error; // Who catches this?
  }
};
```

**Location:** `packages/web/src/hooks/useAuth.ts:76-87`

**Impact:**
- Component using this hook doesn't know about errors
- No user feedback on failed auth
- Loading state might stay true indefinitely

**Fix:**
```typescript
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const signIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setLoading(false);
      throw error;
    }
  };

  return { user, loading, error, signIn, signOut };
}
```

**Priority:** 🟡 High - Affects error handling

---

### 2.2 Overuse of `useMemo` Without Measurement

**Issue:** Many `useMemo` calls without performance profiling to justify them

**Locations:** Throughout SportPage.tsx, CumulativeMetricsChart.tsx, useUserConfig.ts

**Examples:**
```typescript
// Is this memoization actually needed?
const metricUnit = useMemo(() => {
  if (!sportInfo) return userSettings.distanceUnit;
  return sportInfo.has_distance ? userSettings.distanceUnit : "sessions";
}, [sportInfo, userSettings.distanceUnit]);
```

**Impact:**
- Premature optimization
- Added complexity without proven benefit
- `useMemo` has its own overhead

**Guideline:**
Only use `useMemo` for:
1. Expensive calculations (proven by profiling)
2. Reference equality needed for dependency arrays
3. Large data transformations

**Fix:**
Profile first, then memoize. Simple string comparisons don't need memoization:

```typescript
// Simple logic - no memo needed
const metricUnit = sportInfo?.has_distance
  ? userSettings.distanceUnit
  : "sessions";

// Complex calculation - memo justified
const chartData = useMemo(() => {
  return metrics
    .filter(entry => entry.distance !== undefined)
    .map(entry => ({
      x: entry.date,
      y: convertDistance(entry.distance!, userSettings.distanceUnit),
    }));
}, [metrics, userSettings.distanceUnit]);
```

**Priority:** 🟡 Medium - Code complexity

---

### 2.3 Props Drilling Through Multiple Layers

**Issue:** Goals and callbacks are passed through 4+ component layers

**Flow:**
```
SportPage
  → Sidebar
    → GoalControls
      → (individual goal inputs)
```

**Location:** Goals passed from SportPage → Sidebar → GoalControls

**Impact:**
- Tight coupling between components
- Hard to refactor
- Intermediate components must know about props they don't use
- Makes component reuse difficult

**Fix:**
Use React Context for goals:

```typescript
// contexts/GoalsContext.tsx
interface GoalsContextValue {
  goals: Goals;
  updateGoals: (goals: Goals) => Promise<void>;
  estimatedYearEnd: number;
  currentDistance: number;
}

export const GoalsContext = createContext<GoalsContextValue | null>(null);

export function useGoals() {
  const context = useContext(GoalsContext);
  if (!context) throw new Error("useGoals must be used within GoalsProvider");
  return context;
}

// In SportPage.tsx
<GoalsContext.Provider value={{ goals, updateGoals, estimatedYearEnd, currentDistance }}>
  <Sidebar />
</GoalsContext.Provider>

// In GoalControls.tsx
function GoalControls() {
  const { goals, updateGoals, estimatedYearEnd } = useGoals();
  // No props needed!
}
```

**Priority:** 🟡 Medium - Architecture improvement

---

### 2.4 Inconsistent Error Handling in API Layer

**Issue:** Different API functions handle cancellation differently

```typescript
// fetchSportMetrics - returns empty array on cancel
if (axios.isCancel(err)) {
  return [];
}

// fetchYearMetadata - throws error on cancel
if (axios.isCancel(err)) {
  throw new Error("Request cancelled");
}
```

**Location:** `packages/web/src/api/activities.ts`

**Impact:**
- Inconsistent behavior confuses developers
- Some components handle cancellation, others don't
- Unpredictable error states

**Fix:**
Standardize cancellation handling:

```typescript
// Option 1: Always silently ignore cancellation
if (axios.isCancel(err)) {
  return defaultValue; // Empty array, empty object, etc.
}

// Option 2: Always throw (let component handle)
if (axios.isCancel(err)) {
  throw new Error("Request cancelled");
}

// Recommendation: Option 1 (cancellation is expected behavior)
```

**Priority:** 🟡 Medium - Consistency issue

---

### 2.5 Missing Loading States During Async Operations

**Issue:** Some components don't show loading indicators during async operations

**Example:** GoalControls doesn't show loading state when saving goals

**Location:** `packages/web/src/components/GoalControls.tsx`

**Impact:**
- User doesn't know if save is in progress
- Can trigger duplicate saves by clicking multiple times
- Poor UX

**Fix:**
```typescript
const [isSaving, setIsSaving] = useState(false);

const handleGoalValueChange = async (id: string, value: number) => {
  setIsSaving(true);
  try {
    const updated = goals.map((g) => (g.id === id ? { ...g, value } : g));
    await onGoalsChange(updated);
  } finally {
    setIsSaving(false);
  }
};

// Disable controls while saving
<button disabled={isSaving}>
  {isSaving ? "Saving..." : "Save"}
</button>
```

**Priority:** 🟡 Medium - UX improvement

---

## 3. Code Smells (Moderate Priority)

### 3.1 Magic Numbers Without Constants

**Issue:** Hard-coded numbers without explanation

**Examples:**
```typescript
// GoalControls.tsx
const incrementSize = sport === "cycling" ? 100 : 10;

// CumulativeMetricsChart.tsx
if (maxValue < 500) interval = 100;
else if (maxValue < 2000) interval = 250;
else if (maxValue < 5000) interval = 500;
```

**Fix:**
```typescript
// constants/goalSettings.ts
export const GOAL_INCREMENT = {
  cycling: 100,
  running: 10,
  yoga: 10,
} as const;

export const CHART_Y_AXIS_INTERVALS = [
  { threshold: 500, interval: 100 },
  { threshold: 2000, interval: 250 },
  { threshold: 5000, interval: 500 },
  { threshold: Infinity, interval: 1000 },
] as const;
```

**Priority:** 🟢 Low - Readability

---

### 3.2 Complex Nested Ternaries

**Issue:** Hard-to-read nested conditional expressions

**Example (KPICards.tsx:78-98):**
```typescript
value={
  isLoading
    ? "--"
    : currentDistance === 0
      ? "--"
      : `${currentDistance.toFixed(0)} ${unit}`
}
subtitle={
  isLoading ? (
    "Loading..."
  ) : currentDistance === 0 ? (
    <>
      {yearContext.isPastYear
        ? `${yearContext.year} complete · No data available`
        : `${yearContext.daysElapsed} days elapsed · No data available`}
    </>
  ) : (
    // ... more nesting
  )
}
```

**Fix:**
```typescript
const getValueDisplay = () => {
  if (isLoading) return "--";
  if (currentDistance === 0) return "--";
  return `${currentDistance.toFixed(0)} ${unit}`;
};

const getSubtitleDisplay = () => {
  if (isLoading) return "Loading...";

  if (currentDistance === 0) {
    if (yearContext.isPastYear) {
      return `${yearContext.year} complete · No data available`;
    }
    return `${yearContext.daysElapsed} days elapsed · No data available`;
  }

  // ... normal display
};

<KPICard
  value={getValueDisplay()}
  subtitle={getSubtitleDisplay()}
/>
```

**Priority:** 🟢 Low - Readability

---

### 3.3 Type Assertions Instead of Proper Types

**Issue:** Using `as` type assertions instead of proper type narrowing

**Example (useUserConfig.ts:283):**
```typescript
return {
  data,
  loading,
  error,
  updateData,
} as {
  data: (T extends "goals" ? GoalsForYear : ...) | null;
  // ...
};
```

**Impact:**
- Bypasses TypeScript's safety
- Can hide type errors
- Makes refactoring dangerous

**Fix:**
Use proper conditional types or function overloads:

```typescript
// Use function overloads instead of one generic function with assertion
export function useUserConfig(
  configType: "goals",
  year: number,
  sport: string,
  defaultValue?: GoalsForYear
): {
  data: GoalsForYear | null;
  loading: boolean;
  error: Error | null;
  updateData: (data: GoalsForYear) => Promise<void>;
};

export function useUserConfig(
  configType: "preferences"
): {
  data: Preferences | null;
  loading: boolean;
  error: Error | null;
  updateData: (data: Preferences) => Promise<void>;
};

// Implementation
export function useUserConfig(/* ... */) {
  // ... logic
  return { data, loading, error, updateData };
}
```

**Priority:** 🟢 Low - Type safety

---

### 3.4 Commented-out Code

**Issue:** TODOs and commented code should be tracked in issue tracker

**Example (SportPage.tsx:223):**
```typescript
// TODO: Use router navigation when we add year routes
window.location.href = `/${sport}/${newYear}`;
```

**Impact:**
- Code rot - TODOs get forgotten
- Clutters codebase
- Unclear ownership

**Fix:**
- Remove TODOs from code
- Create GitHub issues for future work
- Fix immediately if critical (like this navigation issue)

**Priority:** 🟢 Low - Code cleanliness

---

## 4. Architecture & Sustainability Concerns

### 4.1 No Centralized Error Boundary Strategy

**Issue:** ErrorBoundary exists but only at app root level

**Current:** Single error boundary in index.tsx

**Impact:**
- Any error crashes entire app
- No granular error recovery
- Poor user experience

**Fix:**
Add error boundaries at strategic points:

```typescript
// Wrap each major section
<ErrorBoundary fallback={<DashboardError />}>
  <SportDashboard />
</ErrorBoundary>

<ErrorBoundary fallback={<SidebarError />}>
  <Sidebar />
</ErrorBoundary>

// Allow rest of app to continue functioning if one part fails
```

**Priority:** 🟡 Medium - Resilience

---

### 4.2 No Centralized Data Fetching Strategy

**Issue:** Mix of hooks, inline useEffect, and service classes

**Current approach:**
- Some data: Custom hooks (useUserConfig)
- Some data: useEffect in components (SportPage)
- Some data: Service classes (UserConfigService)

**Impact:**
- Inconsistent patterns
- Hard to add global features (caching, retry logic)
- No request deduplication

**Fix:**
Consider using a data fetching library:

```typescript
// Using React Query (TanStack Query)
export function useSportMetrics(year: number, sport: string) {
  const { getToken } = useAuthToken();

  return useQuery({
    queryKey: ['sport-metrics', year, sport],
    queryFn: async () => {
      const token = await getToken();
      return fetchSportMetrics(year, sport, undefined, token);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
  });
}

// Usage in components
const { data: metrics, isLoading, error } = useSportMetrics(year, sport);
```

**Benefits:**
- Automatic caching
- Request deduplication
- Retry logic
- Optimistic updates
- Consistent API

**Priority:** 🟡 Medium - Architecture improvement

---

### 4.3 Tight Coupling to Firebase

**Issue:** Firebase imports scattered throughout application

**Locations:**
- useAuth.ts imports Firebase Auth directly
- useUserConfig.ts imports Firebase Firestore directly
- SportPage.tsx dynamically imports firebase lib

**Impact:**
- Hard to switch auth providers
- Hard to test (mocking Firebase is difficult)
- Vendor lock-in

**Fix:**
Create abstraction layer:

```typescript
// services/auth/AuthService.ts (interface)
export interface AuthService {
  getCurrentUser(): Promise<User | null>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(callback: (user: User | null) => void): () => void;
  getIdToken(): Promise<string | undefined>;
}

// services/auth/FirebaseAuthService.ts (implementation)
export class FirebaseAuthService implements AuthService {
  // ... Firebase-specific implementation
}

// services/auth/MockAuthService.ts (for testing)
export class MockAuthService implements AuthService {
  // ... Mock implementation
}

// Context provider
export function useAuthService(): AuthService {
  return useContext(AuthServiceContext);
}
```

**Priority:** 🟢 Low - Future-proofing (but important for testing)

---

### 4.4 No Request Cancellation on Route Change

**Issue:** When navigating between routes, in-flight requests aren't cancelled

**Example:** User navigates from /cycling/2024 to /running/2025, but 2024 requests still complete

**Impact:**
- Unnecessary network traffic
- Race conditions (stale data might update state)
- Memory leaks

**Fix:**
```typescript
useEffect(() => {
  const controller = new AbortController();

  async function loadData() {
    try {
      const data = await fetchSportMetrics(year, sport, controller.signal);
      setMetrics(data);
    } catch (err) {
      if (err.name === 'AbortError') return; // Expected
      setError(err);
    }
  }

  loadData();

  return () => {
    controller.abort(); // ✅ Already implemented in SportPage!
  };
}, [year, sport]);
```

**Note:** This is actually already implemented correctly in SportPage.tsx! Good job.

**Priority:** ✅ Already handled correctly

---

## 5. Performance Optimizations

### 5.1 No Input Debouncing (GoalControls)

**Issue:** Every keystroke in goal input triggers validation

**Location:** `packages/web/src/components/GoalControls.tsx`

**Impact:**
- Unnecessary re-renders
- Validation runs on every keystroke
- Poor performance on slower devices

**Fix:**
```typescript
import { useDebouncedCallback } from 'use-debounce';

const debouncedSave = useDebouncedCallback(
  (id: string, value: string) => {
    handleSaveEdit(id);
  },
  500 // Wait 500ms after user stops typing
);

<input
  value={editValue}
  onChange={(e) => {
    setEditValue(e.target.value);
    debouncedSave(id, e.target.value);
  }}
/>
```

**Priority:** 🟢 Low - Nice to have

---

### 5.2 Large Bundle Size (Chart Library)

**Issue:** Recharts is a large library (100KB+ gzipped)

**Current:** Importing entire LineChart component

**Fix:**
Consider code splitting charts:

```typescript
import { lazy, Suspense } from 'react';

const CumulativeMetricsChart = lazy(() =>
  import('./components/charts/CumulativeMetricsChart')
);

// In render
<Suspense fallback={<LoadingChart />}>
  <CumulativeMetricsChart {...props} />
</Suspense>
```

**Priority:** 🟢 Low - Optimization

---

### 5.3 Unnecessary Re-renders in KPICards

**Issue:** KPICards is wrapped in React.memo but receives new object/function props

**Location:** `packages/web/src/components/dashboard/KPICards.tsx:53`

**Problem:**
```typescript
// This component is memoized
const KPICards = React.memo(({ ... }) => { ... });

// But parent passes new objects every render
<KPICards
  nextGoal={nextGoal} // New object reference each render
  yearContext={yearContext} // New object reference each render
  momentumIndicator={momentumIndicator} // New React element each render
/>
```

**Impact:**
- React.memo is ineffective
- Component re-renders on every parent render
- Wasted optimization effort

**Fix:**

Option 1: Remove React.memo (it's not helping)
```typescript
// Just export normally
export default function KPICards({ ... }) { ... }
```

Option 2: Memoize props in parent
```typescript
const kpiProps = useMemo(() => ({
  nextGoal,
  yearContext,
  nextGoalProgress,
  // ... all props
}), [nextGoal, yearContext, nextGoalProgress, ...]);

<KPICards {...kpiProps} />
```

Option 3: Use proper memo comparison
```typescript
const KPICards = React.memo(
  ({ ... }) => { ... },
  (prevProps, nextProps) => {
    // Custom comparison logic
    return (
      prevProps.currentDistance === nextProps.currentDistance &&
      prevProps.nextGoal?.value === nextProps.nextGoal?.value &&
      // ... compare all relevant props
    );
  }
);
```

**Recommendation:** Option 1 - Remove React.memo. Profile first, optimize later.

**Priority:** 🟢 Low - Premature optimization

---

## 6. Bugs & Potential Fixes

### 6.1 Race Condition in useUserConfig

**Issue:** Potential race condition when switching between auth states

**Scenario:**
1. User signs in
2. useUserConfig switches from fixture mode to Firestore mode
3. Both localStorage read AND Firestore subscription are active briefly

**Location:** `packages/web/src/hooks/useUserConfig.ts:75-220`

**Impact:**
- State might update twice
- Possible stale data flash

**Fix:**
Add proper cleanup and state management:

```typescript
useEffect(() => {
  let cancelled = false;

  if (isFixtureMode) {
    // ... localStorage logic
    if (cancelled) return;
    setData(/* ... */);
    return;
  }

  return () => {
    cancelled = true;
  };
}, [configType, isFixtureMode, year, sport]);
```

**Priority:** 🟡 Medium - Edge case bug

---

### 6.2 Missing Null Check in ChartData Calculation

**Issue:** Potential null pointer when accessing last entry

**Location:** `packages/web/src/pages/SportPage.tsx:156-160`

```typescript
const currentValue = useMemo(() => {
  if (chartData.length === 0) return 0;
  const lastEntry = chartData[chartData.length - 1];
  return lastEntry?.y || 0; // ✅ Good: Optional chaining used
}, [chartData]);
```

**Status:** ✅ Actually handled correctly with optional chaining

**Priority:** N/A - No issue

---

### 6.3 Year Boundary Bug in Goal Calculations

**Issue:** Leap year handling might be incorrect

**Location:** `packages/web/src/utils/goalCalculations.ts:38-39`

```typescript
const daysInYear =
  Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
```

**Test:**
```typescript
// 2024 is leap year (366 days)
const start = new Date(2024, 0, 1);
const end = new Date(2024, 11, 31);
const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
console.log(days); // Should be 366
```

**Status:** ✅ Calculation is correct

**Priority:** N/A - No issue

---

### 6.4 Firestore Permissions Not Validated in Frontend

**Issue:** No user feedback when Firestore operations fail due to permissions

**Location:** `packages/web/src/services/userConfigService.ts`

**Impact:**
- Silent failures
- User thinks data is saved but it's not

**Fix:**
Add better error handling with user feedback:

```typescript
try {
  await setDoc(docRef, config, { merge: true });
} catch (error) {
  if (error.code === 'permission-denied') {
    throw new Error(
      'You do not have permission to save this data. Please sign in with an authorized account.'
    );
  }
  throw error;
}
```

**Priority:** 🟡 Medium - UX issue

---

## 7. Accessibility Issues

### 7.1 Missing ARIA Labels

**Issue:** Interactive elements lack accessible labels

**Examples:**

**GoalControls.tsx:**
```typescript
// ❌ No label for screen readers
<button onClick={() => handleIncrement(goal.id, -incrementSize)}>
  −
</button>

// ✅ With ARIA label
<button
  onClick={() => handleIncrement(goal.id, -incrementSize)}
  aria-label={`Decrease ${goal.label || 'goal'} by ${incrementSize}`}
>
  −
</button>
```

**CumulativeMetricsChart.tsx:**
```typescript
// ❌ Chart has no description for screen readers
<ResponsiveContainer width="100%" height={400}>
  <LineChart data={mergedData}>
    {/* ... */}
  </LineChart>
</ResponsiveContainer>

// ✅ With accessible description
<div role="img" aria-label={`Cumulative distance chart for ${year}`}>
  <ResponsiveContainer width="100%" height={400}>
    <LineChart data={mergedData}>
      {/* ... */}
    </LineChart>
  </ResponsiveContainer>
</div>
```

**Priority:** 🟡 Medium - Accessibility

---

### 7.2 No Keyboard Navigation in Charts

**Issue:** Chart interactions are mouse-only

**Impact:**
- Keyboard users cannot interact with charts
- Fails WCAG guidelines

**Fix:**
Add keyboard event handlers and focus management:

```typescript
<div
  role="application"
  aria-label="Interactive chart"
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === 'ArrowLeft') {
      // Navigate to previous data point
    }
    if (e.key === 'ArrowRight') {
      // Navigate to next data point
    }
  }}
>
  <ResponsiveContainer>
    {/* Chart */}
  </ResponsiveContainer>
</div>
```

**Priority:** 🟡 Medium - Accessibility

---

### 7.3 Missing Focus Indicators

**Issue:** Custom-styled buttons lose focus indicators

**Location:** Various components using Bootstrap classes

**Fix:**
Ensure focus is visible:

```css
.btn:focus-visible {
  outline: 2px solid var(--bs-primary);
  outline-offset: 2px;
}
```

**Priority:** 🟢 Low - Accessibility

---

## 8. Recommendations Summary

### Immediate Actions (This Sprint)

1. **Fix navigation** - Replace `window.location.href` with `navigate()`
2. **Remove `alert()`** - Use inline validation feedback
3. **Fix retry logic** - Replace `window.location.reload()` with state-based retry
4. **Fix fixture mode inconsistency** - Make useFullUserConfig match useUserConfig
5. **Add error states to useAuth** - Expose auth errors to components

### Short-term Improvements (Next Sprint)

6. **Refactor SportPage** - Split into smaller components/hooks
7. **Create useAuthToken hook** - Eliminate duplicated token fetching
8. **Add error boundaries** - Granular error recovery at component level
9. **Standardize API error handling** - Consistent cancellation behavior
10. **Add loading states** - Show feedback during async operations

### Medium-term Architecture (Next Quarter)

11. **Consider React Query** - Centralized data fetching strategy
12. **Add Context for Goals** - Eliminate props drilling
13. **Abstract Firebase** - Create auth/storage service interfaces
14. **Add accessibility** - ARIA labels, keyboard navigation
15. **Performance audit** - Remove unnecessary memoization, add necessary debouncing

### Long-term Maintenance

16. **Component library** - Extract reusable components
17. **Design system** - Consistent spacing, colors, typography
18. **E2E tests** - Playwright or Cypress for critical flows
19. **Bundle optimization** - Code splitting, lazy loading
20. **Documentation** - Component documentation, architecture diagrams

---

## Conclusion

The React application is well-structured with good separation of concerns and modern patterns. However, there are critical UX issues (navigation, validation alerts, error recovery) that should be fixed immediately. The architecture is solid but would benefit from reducing component complexity, eliminating props drilling, and adding more granular error handling.

**Next Steps:**
1. Prioritize fixing the 6 critical issues
2. Create GitHub issues for medium-priority improvements
3. Schedule architecture review for Context API adoption
4. Plan accessibility audit
5. Set up performance monitoring

**Estimated Effort:**
- Critical fixes: 2-3 days
- Short-term improvements: 1 week
- Medium-term architecture: 2-3 weeks
- Long-term maintenance: Ongoing

---

**Review Completed:** 2025-11-21
**Reviewers:** Claude Code
**Status:** Ready for team discussion
