import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Next.js 16 proxy (replaces middleware)
export default function proxy(request: NextRequest) {
    const sessionToken = request.cookies.get('better-auth.session_token') ||
        request.cookies.get('__Secure-better-auth.session_token');

    // Auth is handled via a dialog on the main page, so no `/login` route is needed.
    // If a user happens to visit /login or /signup directly, redirect them to the main page.
    if (request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/signup')) {
        return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
