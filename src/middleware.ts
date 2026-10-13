import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET_KEY = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'bmp-resproject-jwt-secret-key-2026-secure-factory-auth'
);

const COOKIE_NAME = 'session_token';

// Route Access Matrix by Role
function isRouteAllowedForRole(role: string, pathname: string): boolean {
  if (role === 'ADMIN') return true; // Admin has access to all routes

  // Public/Shared for all logged-in users
  if (
    pathname === '/' ||
    pathname === '/inventory' ||
    pathname === '/transactions' ||
    pathname.startsWith('/production/') // includes print page
  ) {
    return true;
  }

  if (role === 'STORE') {
    // Store/Warehouse: scan, inbound, sections
    return (
      pathname.startsWith('/scan') ||
      pathname.startsWith('/inbound') ||
      pathname.startsWith('/sections')
    );
  }

  if (role === 'PROD') {
    // Production/Planning: production calculation, orders, recipes
    return (
      pathname.startsWith('/production') ||
      pathname.startsWith('/recipes')
    );
  }

  if (role === 'VIEWER') {
    // Viewer: read-only access to dashboard, inventory, transactions
    return pathname === '/' || pathname === '/inventory' || pathname === '/transactions';
  }

  return false;
}

const PUBLIC_VIEW_PAGES = ['/', '/inventory', '/transactions'];

function isPublicViewPage(pathname: string): boolean {
  if (PUBLIC_VIEW_PAGES.includes(pathname)) return true;
  if (pathname.startsWith('/production/') && pathname.endsWith('/print')) return true;
  return false;
}

// Read-only API routes that guests can fetch
function isPublicReadApi(pathname: string, method: string): boolean {
  if (method !== 'GET') return false;
  return (
    pathname === '/api/dashboard/stats' ||
    pathname.startsWith('/api/materials') ||
    pathname.startsWith('/api/sections') ||
    pathname.startsWith('/api/transactions') ||
    pathname.startsWith('/api/lots') ||
    pathname.startsWith('/api/products')
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;

  // 1. Allow public files and auth API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/logout') ||
    pathname.startsWith('/api/auth/me') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  let decodedUser: { id: string; username: string; role: string } | null = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, SECRET_KEY);
      if (payload.id && payload.role) {
        decodedUser = {
          id: payload.id as string,
          username: payload.username as string,
          role: payload.role as string,
        };
      }
    } catch {
      decodedUser = null;
    }
  }

  // 2. Allow visiting /login freely (so users can login or switch accounts)
  if (pathname === '/login') {
    return NextResponse.next();
  }

  // 3. If NOT logged in (Guest / Viewer):
  if (!decodedUser) {
    // A) If public read-only API GET request -> Allow
    if (pathname.startsWith('/api/')) {
      if (isPublicReadApi(pathname, method)) {
        return NextResponse.next();
      }
      return NextResponse.json(
        { error: 'กรุณาเข้าสู่ระบบก่อนทำการเพิ่ม ลบ หรือแก้ไขข้อมูล' },
        { status: 401 }
      );
    }

    // B) If public view web page -> Allow guest to view!
    if (isPublicViewPage(pathname)) {
      return NextResponse.next();
    }

    // C) Protected page -> redirect to /login
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 4. Role-Based Access Control for logged-in users on pages
  if (!pathname.startsWith('/api/')) {
    const isAllowed = isRouteAllowedForRole(decodedUser.role, pathname);
    if (!isAllowed) {
      // Unauthorized page -> redirect to dashboard
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // 5. Block write API requests for VIEWER role (Read-only user)
  if (decodedUser.role === 'VIEWER' && pathname.startsWith('/api/')) {
    if (method !== 'GET' && !pathname.startsWith('/api/auth/')) {
      return NextResponse.json(
        { error: 'ผู้ใช้งานประเภทดูข้อมูล (Viewer) สามารถดูข้อมูลได้อย่างเดียว ไม่สามารถเพิ่ม ลบ หรือแก้ไขข้อมูลได้' },
        { status: 403 }
      );
    }
  }

  // 6. Special protection for ADMIN only pages & APIs
  if (
    pathname.startsWith('/db-studio') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/api/admin/') ||
    pathname.startsWith('/api/users')
  ) {
    if (decodedUser.role !== 'ADMIN') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'เฉพาะแอดมินเท่านั้นที่สามารถดำเนินการได้' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
