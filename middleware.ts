import { NextResponse, type NextRequest } from "next/server";

/** /fw 已重命名为 /quill（对齐品牌名 Quill）。
 *  旧链接、书签、会话分享链接继续可用：
 *  - 页面路径 301 永久跳转，保留 query string；
 *  - /api/fw/* 用 308 —— 永久跳转但保留请求方法，避免 POST /api/fw/sessions 被降级成 GET。 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/fw");

  const url = request.nextUrl.clone();
  url.pathname = isApi ? pathname.replace("/api/fw", "/api/quill") : pathname.replace("/fw", "/quill");
  url.search = search;

  return NextResponse.redirect(url, isApi ? 308 : 301);
}

export const config = {
  matcher: ["/fw", "/fw/:path*", "/api/fw", "/api/fw/:path*"],
};
