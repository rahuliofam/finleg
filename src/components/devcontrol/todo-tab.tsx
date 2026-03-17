"use client";

import dynamic from "next/dynamic";

const TodoPage = dynamic(
  () => import("@/app/devcontrol/todo/page"),
  { ssr: false }
);

export function TodoTab() {
  return (
    <div className="devcontrol-embed">
      <TodoPage />
    </div>
  );
}
