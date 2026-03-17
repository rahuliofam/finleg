"use client";

import dynamic from "next/dynamic";

const TodoPage = dynamic(
  () => import("@/app/clauded/todo/page"),
  { ssr: false }
);

export function TodoTab() {
  return (
    <div className="clauded-embed">
      <TodoPage />
    </div>
  );
}
