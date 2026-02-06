"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

const COOKIE_NAME = "sb-rollback";

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;expires=${expires};SameSite=Lax`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT;SameSite=Lax`;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const RollbackContext = createContext<{
  rollbackDate: string | null;
  setRollbackDate: (date: string | null) => void;
  isActive: boolean;
} | null>(null);

export function RollbackProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [rollbackDate, setRollbackDateState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return readCookie(COOKIE_NAME) || null;
  });

  const setRollbackDate = useCallback(
    (date: string | null) => {
      setRollbackDateState(date);
      if (date) {
        setCookie(COOKIE_NAME, date);
      } else {
        deleteCookie(COOKIE_NAME);
      }
      router.refresh();
    },
    [router],
  );

  return (
    <RollbackContext.Provider
      value={{ rollbackDate, setRollbackDate, isActive: !!rollbackDate }}
    >
      {children}
    </RollbackContext.Provider>
  );
}

export function useRollback() {
  const context = useContext(RollbackContext);
  if (!context) {
    throw new Error("useRollback must be used within RollbackProvider");
  }
  return context;
}
