import { redirect } from "next/navigation";

/** 默认入口为 Quill 工作台（/quill）。
 *  旧路径 /fw 由 middleware 301 跳转过来，旧链接与书签继续可用。 */
export default function HomePage() {
  redirect("/quill");
}
