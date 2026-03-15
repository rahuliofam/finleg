"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface AppUser {
  id: string;
  auth_user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  provider: string | null;
  last_sign_in: string | null;
  last_login_at: string | null;
  created_at: string;
  is_archived: boolean;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  invited_by_email: string | null;
  invited_at: string;
  expires_at: string;
  status: string;
}

const ROLES = [
  { value: "admin", label: "Admin", color: "bg-red-100 text-red-700" },
  { value: "family", label: "Family", color: "bg-green-100 text-green-700" },
  { value: "accountant", label: "Accountant", color: "bg-blue-100 text-blue-700" },
  { value: "collaborator", label: "Collaborator", color: "bg-amber-100 text-amber-700" },
];

function getRoleStyle(role: string) {
  return ROLES.find((r) => r.value === role)?.color || "bg-gray-100 text-gray-500";
}

export function UsersTab() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("public");
  const [inviting, setInviting] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);

  async function fetchData() {
    setLoading(true);
    const [usersResult, invResult] = await Promise.all([
      supabase.rpc("list_app_users"),
      supabase
        .from("user_invitations")
        .select("*")
        .eq("status", "pending")
        .order("invited_at", { ascending: false }),
    ]);

    if (usersResult.error) {
      setError(usersResult.error.message);
    } else {
      setUsers(usersResult.data || []);
    }

    if (!invResult.error) {
      setInvitations(invResult.data || []);
    }

    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: invError } = await supabase.from("user_invitations").insert({
      email: inviteEmail.toLowerCase().trim(),
      role: inviteRole,
      invited_by_email: user?.email || null,
    });

    if (invError) {
      setError(invError.message);
    } else {
      setInviteEmail("");
      setInviteRole("public");
      setShowInviteForm(false);
      fetchData();
    }
    setInviting(false);
  }

  async function handleRevokeInvitation(id: string) {
    await supabase.from("user_invitations").update({ status: "revoked" }).eq("id", id);
    fetchData();
  }

  async function handleRoleChange(userId: string, newRole: string) {
    const { error: rpcError } = await supabase.rpc("update_user_role", {
      p_user_id: userId,
      p_role: newRole,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setEditingRole(null);
      fetchData();
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return email[0].toUpperCase();
  };

  const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="text-sm text-slate-500 mt-1">
            {loading
              ? "Loading..."
              : `${users.length} user${users.length !== 1 ? "s" : ""} with access`}
          </p>
        </div>
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          className="px-4 py-2 text-sm font-medium text-white bg-[#1B6B3A] hover:bg-[#145530] rounded-lg transition-colors"
        >
          {showInviteForm ? "Cancel" : "Invite User"}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Invite Form */}
      {showInviteForm && (
        <form
          onSubmit={handleInvite}
          className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Send Invitation</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/30 focus:border-[#1B6B3A] text-slate-900"
              />
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/30 focus:border-[#1B6B3A] text-slate-900"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#1B6B3A] hover:bg-[#145530] rounded-lg transition-colors disabled:opacity-50"
            >
              {inviting ? "Sending..." : "Send Invite"}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            The user will be assigned this role when they sign in with Google. Invitation expires in 7
            days.
          </p>
        </form>
      )}

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            Pending Invitations ({invitations.length})
          </h2>
          <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-200">
                  <th className="text-left text-xs font-medium text-amber-800 px-4 py-2">Email</th>
                  <th className="text-left text-xs font-medium text-amber-800 px-4 py-2">Role</th>
                  <th className="text-left text-xs font-medium text-amber-800 px-4 py-2">
                    Invited
                  </th>
                  <th className="text-left text-xs font-medium text-amber-800 px-4 py-2">
                    Expires
                  </th>
                  <th className="text-right text-xs font-medium text-amber-800 px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-amber-100 last:border-b-0"
                  >
                    <td className="px-4 py-2 text-sm text-slate-900">{inv.email}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${getRoleStyle(inv.role)}`}
                      >
                        {inv.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {formatDate(inv.invited_at)}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <span className={isExpired(inv.expires_at) ? "text-red-600 font-medium" : "text-slate-600"}>
                        {isExpired(inv.expires_at) ? "Expired" : formatDate(inv.expires_at)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => handleRevokeInvitation(inv.id)}
                        className="text-xs text-red-600 hover:text-red-800 font-medium"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Users Table */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          Loading users...
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          No users found. Invite someone to get started.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left text-sm font-medium text-slate-700 px-6 py-3">User</th>
                <th className="text-left text-sm font-medium text-slate-700 px-6 py-3">Role</th>
                <th className="text-left text-sm font-medium text-slate-700 px-6 py-3">
                  Provider
                </th>
                <th className="text-left text-sm font-medium text-slate-700 px-6 py-3">
                  Last Sign In
                </th>
                <th className="text-left text-sm font-medium text-slate-700 px-6 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt=""
                          className="w-8 h-8 rounded-full"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-medium">
                          {getInitials(user.display_name, user.email)}
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {user.display_name || "No name"}
                        </div>
                        <div className="text-xs text-slate-500">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    {editingRole === user.id ? (
                      <select
                        defaultValue={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        onBlur={() => setEditingRole(null)}
                        autoFocus
                        className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/30 text-slate-900"
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => setEditingRole(user.id)}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize cursor-pointer hover:ring-2 hover:ring-slate-300 transition-shadow ${getRoleStyle(user.role)}`}
                        title="Click to change role"
                      >
                        {user.role}
                      </button>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                      {user.provider || "email"}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-600">
                    {formatDate(user.last_sign_in)}
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-600">
                    {formatDate(user.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
