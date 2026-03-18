"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Feature 4: My Tasks Widget
 * Shows actionable to-do items from the todos table.
 * Self-contained — remove this import from _overview.tsx to back out.
 */

interface Todo {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  created_at: string;
}

export default function MyTasks() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(async () => {
    const { data } = await supabase
      .from("todos")
      .select("id, title, status, priority, created_at")
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(8);

    setTodos(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const handleComplete = async (id: string) => {
    await supabase.from("todos").update({ status: "closed" }).eq("id", id);
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">My Tasks</h2>
        <div className="text-sm text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">My Tasks</h2>
        {todos.length > 0 && (
          <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
            {todos.length} open
          </span>
        )}
      </div>
      {todos.length === 0 ? (
        <p className="text-sm text-slate-400">All caught up — no open tasks.</p>
      ) : (
        <div className="space-y-1.5">
          {todos.map((todo) => (
            <div
              key={todo.id}
              className="flex items-center gap-2 group"
            >
              <button
                onClick={() => handleComplete(todo.id)}
                className="flex-shrink-0 w-4 h-4 rounded border border-slate-300 hover:border-green-500 hover:bg-green-50 transition-colors"
                title="Mark complete"
              />
              <span className="text-sm text-slate-700 flex-1 truncate">{todo.title}</span>
              {todo.status === "in_progress" && (
                <span className="text-[10px] bg-blue-50 text-blue-600 px-1 py-0.5 rounded flex-shrink-0">
                  in progress
                </span>
              )}
              {todo.priority === "high" && (
                <span className="text-[10px] bg-red-50 text-red-600 px-1 py-0.5 rounded flex-shrink-0">
                  high
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
