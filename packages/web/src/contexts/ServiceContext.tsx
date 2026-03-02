/**
 * Service Context for dependency injection
 *
 * Provides auth and database services to the application via React Context.
 * Use ServiceProvider in production, TestServiceProvider in tests.
 */

import React, { createContext, useContext, useMemo } from "react";
import type { AuthService } from "../services/auth/AuthService";
import type { DatabaseService } from "../services/database/DatabaseService";
import { FirebaseAuthService } from "../services/auth/FirebaseAuthService";
import { FirestoreService } from "../services/database/FirestoreService";
import { MockAuthService } from "../services/auth/MockAuthService";
import { MockDatabaseService } from "../services/database/MockDatabaseService";

interface Services {
  authService: AuthService;
  databaseService: DatabaseService;
}

const ServiceContext = createContext<Services | null>(null);

/**
 * Production service provider - uses Firebase implementations.
 * In local dev, Firebase emulators handle auth and Firestore.
 */
export function ServiceProvider({ children }: { children: React.ReactNode }) {
  const services = useMemo<Services>(() => {
    return {
      authService: new FirebaseAuthService(),
      databaseService: new FirestoreService(),
    };
  }, []);

  return <ServiceContext.Provider value={services}>{children}</ServiceContext.Provider>;
}

/**
 * Test service provider - uses mock implementations by default
 * Pass custom services to override specific implementations
 */
export function TestServiceProvider({
  children,
  authService,
  databaseService,
}: {
  children: React.ReactNode;
  authService?: AuthService;
  databaseService?: DatabaseService;
}) {
  const services = useMemo<Services>(
    () => ({
      authService: authService ?? new MockAuthService(),
      databaseService: databaseService ?? new MockDatabaseService(),
    }),
    [authService, databaseService]
  );

  return <ServiceContext.Provider value={services}>{children}</ServiceContext.Provider>;
}

/**
 * Hook to access the auth service
 */
export function useAuthService(): AuthService {
  const services = useContext(ServiceContext);
  if (!services) {
    throw new Error("useAuthService must be used within a ServiceProvider");
  }
  return services.authService;
}

/**
 * Hook to access the database service
 */
export function useDatabaseService(): DatabaseService {
  const services = useContext(ServiceContext);
  if (!services) {
    throw new Error("useDatabaseService must be used within a ServiceProvider");
  }
  return services.databaseService;
}

/**
 * Hook to access all services (for components that need both)
 */
export function useServices(): Services {
  const services = useContext(ServiceContext);
  if (!services) {
    throw new Error("useServices must be used within a ServiceProvider");
  }
  return services;
}
