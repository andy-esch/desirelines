import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  TestServiceProvider,
  useAuthService,
  useDatabaseService,
  useServices,
} from "./ServiceContext";
import { MockAuthService } from "../services/auth/MockAuthService";
import { MockDatabaseService } from "../services/database/MockDatabaseService";

describe("ServiceContext", () => {
  describe("useAuthService", () => {
    it("returns the auth service from context", () => {
      const authService = new MockAuthService();
      const { result } = renderHook(() => useAuthService(), {
        wrapper: ({ children }) => (
          <TestServiceProvider authService={authService}>{children}</TestServiceProvider>
        ),
      });

      expect(result.current).toBe(authService);
    });

    it("throws when used outside ServiceProvider", () => {
      expect(() => {
        renderHook(() => useAuthService());
      }).toThrow("useAuthService must be used within a ServiceProvider");
    });
  });

  describe("useDatabaseService", () => {
    it("returns the database service from context", () => {
      const dbService = new MockDatabaseService();
      const { result } = renderHook(() => useDatabaseService(), {
        wrapper: ({ children }) => (
          <TestServiceProvider databaseService={dbService}>{children}</TestServiceProvider>
        ),
      });

      expect(result.current).toBe(dbService);
    });

    it("throws when used outside ServiceProvider", () => {
      expect(() => {
        renderHook(() => useDatabaseService());
      }).toThrow("useDatabaseService must be used within a ServiceProvider");
    });
  });

  describe("useServices", () => {
    it("returns both auth and database services", () => {
      const authService = new MockAuthService();
      const dbService = new MockDatabaseService();
      const { result } = renderHook(() => useServices(), {
        wrapper: ({ children }) => (
          <TestServiceProvider authService={authService} databaseService={dbService}>
            {children}
          </TestServiceProvider>
        ),
      });

      expect(result.current.authService).toBe(authService);
      expect(result.current.databaseService).toBe(dbService);
    });

    it("throws when used outside ServiceProvider", () => {
      expect(() => {
        renderHook(() => useServices());
      }).toThrow("useServices must be used within a ServiceProvider");
    });
  });

  describe("TestServiceProvider", () => {
    it("provides mock services by default when no services are passed", () => {
      const { result } = renderHook(() => useServices(), {
        wrapper: ({ children }) => <TestServiceProvider>{children}</TestServiceProvider>,
      });

      expect(result.current.authService).toBeDefined();
      expect(result.current.databaseService).toBeDefined();
    });

    it("allows overriding specific services", () => {
      const customAuth = new MockAuthService();
      const { result } = renderHook(() => useServices(), {
        wrapper: ({ children }) => (
          <TestServiceProvider authService={customAuth}>{children}</TestServiceProvider>
        ),
      });

      expect(result.current.authService).toBe(customAuth);
      // Database service should still be a default mock
      expect(result.current.databaseService).toBeDefined();
    });
  });
});
