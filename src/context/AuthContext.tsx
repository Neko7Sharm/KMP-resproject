'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SessionUser, UserRole, ROLE_CONFIG } from '@/lib/authTypes';

interface AuthContextType {
  user: SessionUser | null;
  loading: boolean;
  role: UserRole | null;
  isAdmin: boolean;
  isStore: boolean;
  isProd: boolean;
  isViewer: boolean;
  canEdit: boolean;
  roleConfig: typeof ROLE_CONFIG[UserRole] | null;
  canAccessRoute: (pathname: string) => boolean;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  role: null,
  isAdmin: false,
  isStore: false,
  isProd: false,
  isViewer: false,
  canEdit: false,
  roleConfig: null,
  canAccessRoute: () => false,
  logout: async () => {},
  refreshUser: async () => {},
});

// Route Access Matrix
export function checkRouteAccess(role: UserRole | null | undefined, pathname: string): boolean {
  const effectiveRole = role || 'VIEWER';
  if (effectiveRole === 'ADMIN') return true; // Admin has access to all routes

  // Public / Shared for all users (including unauthenticated guests)
  if (
    pathname === '/' ||
    pathname === '/inventory' ||
    pathname === '/transactions' ||
    (pathname.startsWith('/production/') && pathname.endsWith('/print'))
  ) {
    return true;
  }

  if (effectiveRole === 'STORE') {
    // Store/Warehouse: scan, inbound, sections
    return (
      pathname.startsWith('/scan') ||
      pathname.startsWith('/inbound') ||
      pathname.startsWith('/sections')
    );
  }

  if (effectiveRole === 'PROD') {
    // Production/Planning: production calculation/orders, recipes
    return (
      pathname.startsWith('/production') ||
      pathname.startsWith('/recipes')
    );
  }

  if (effectiveRole === 'VIEWER') {
    // Viewer: read-only access to dashboard, inventory, transactions
    return (
      pathname === '/' ||
      pathname === '/inventory' ||
      pathname === '/transactions' ||
      (pathname.startsWith('/production/') && pathname.endsWith('/print'))
    );
  }

  return false;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      setUser(null);
      window.location.assign('/login');
    }
  }, []);

  const role = user?.role || null;
  const isAdmin = role === 'ADMIN';
  const isStore = role === 'STORE';
  const isProd = role === 'PROD';
  const isViewer = role === 'VIEWER' || !role; // Unauthenticated guest is also VIEWER
  const canEdit = !isViewer && !!role; // Only authenticated non-VIEWER can edit

  const roleConfig = role ? ROLE_CONFIG[role] : ROLE_CONFIG['VIEWER'];

  const canAccessRoute = useCallback(
    (pathname: string) => checkRouteAccess(role, pathname),
    [role]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        role,
        isAdmin,
        isStore,
        isProd,
        isViewer,
        canEdit,
        roleConfig,
        canAccessRoute,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
