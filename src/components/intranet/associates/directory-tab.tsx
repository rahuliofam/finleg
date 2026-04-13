"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Contact {
  id: string;
  name: string;
  title: string | null;
  organization: string | null;
  category: string;
  email: string | null;
  phone: string | null;
  fax: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  website: string | null;
  notes: string | null;
  source: string | null;
  tags: string[];
  is_archived: boolean;
  created_at: string;
}

export function DirectoryTab() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: "", title: "", organization: "", category: "",
    email: "", phone: "", fax: "",
    address_line1: "", city: "", state: "", zip: "",
    website: "", notes: "", source: "", tags: "",
  });

  async function fetchContacts() {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("contacts")
      .select("*")
      .eq("is_archived", false)
      .order("category")
      .order("name");

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setContacts(data || []);
    }
    setLoading(false);
  }

  useEffect(() => { fetchContacts(); }, []);

  const categories = [...new Set(contacts.map((c) => c.category))].sort();

  const filtered = contacts.filter((c) => {
    if (selectedCategory && c.category !== selectedCategory) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.organization?.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q)) ||
      c.notes?.toLowerCase().includes(q)
    );
  });

  const grouped = filtered.reduce<Record<string, Contact[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error: insertError } = await supabase.from("contacts").insert({
      name: formData.name,
      title: formData.title || null,
      organization: formData.organization || null,
      category: formData.category,
      email: formData.email || null,
      phone: formData.phone || null,
      fax: formData.fax || null,
      address_line1: formData.address_line1 || null,
      city: formData.city || null,
      state: formData.state || null,
      zip: formData.zip || null,
      website: formData.website || null,
      notes: formData.notes || null,
      source: formData.source || null,
      tags: formData.tags ? formData.tags.split(",").map((t) => t.trim()) : [],
    });
    if (insertError) {
      setError(insertError.message);
    } else {
      setFormData({
        name: "", title: "", organization: "", category: "",
        email: "", phone: "", fax: "",
        address_line1: "", city: "", state: "", zip: "",
        website: "", notes: "", source: "", tags: "",
      });
      setShowAddForm(false);
      fetchContacts();
    }
    setSaving(false);
  }

  async function handleArchive(id: string) {
    await supabase.from("contacts").update({ is_archived: true }).eq("id", id);
    fetchContacts();
  }

  function field(label: string, key: keyof typeof formData, opts?: { required?: boolean; placeholder?: string; type?: string }) {
    return (
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
        <input
          type={opts?.type || "text"}
          value={formData[key]}
          onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
          required={opts?.required}
          placeholder={opts?.placeholder}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/30 focus:border-[#1B6B3A] text-slate-900"
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contacts Directory</h1>
          <p className="text-sm text-slate-500 mt-1">
            {loading ? "Loading..." : `${contacts.length} contact${contacts.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 text-sm font-medium text-white bg-[#1B6B3A] hover:bg-[#145530] rounded-lg transition-colors"
        >
          {showAddForm ? "Cancel" : "Add Contact"}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Dismiss</button>
        </div>
      )}

      {/* Add Form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">New Contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {field("Name", "name", { required: true })}
            {field("Title", "title", { placeholder: "e.g. Legal Services Manager" })}
            {field("Organization", "organization")}
            {field("Category", "category", { required: true, placeholder: "e.g. Real Estate Attorney" })}
            {field("Email", "email", { type: "email" })}
            {field("Phone", "phone", { type: "tel" })}
            {field("Fax", "fax", { type: "tel" })}
            {field("Address", "address_line1")}
            {field("City", "city")}
            {field("State", "state")}
            {field("ZIP", "zip")}
            {field("Website", "website")}
            {field("Source", "source", { placeholder: "Where did you find this contact?" })}
            {field("Tags", "tags", { placeholder: "comma-separated, e.g. texas, real-estate" })}
          </div>
          <div className="mt-3">
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/30 focus:border-[#1B6B3A] text-slate-900"
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-[#1B6B3A] hover:bg-[#145530] rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Contact"}
            </button>
          </div>
        </form>
      )}

      {/* Search + Filter */}
      {!loading && contacts.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/30 focus:border-[#1B6B3A] text-slate-900"
          />
          <select
            value={selectedCategory || ""}
            onChange={(e) => setSelectedCategory(e.target.value || null)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B6B3A]/30 focus:border-[#1B6B3A] text-slate-900"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      )}

      {/* Directory */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">Loading contacts...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          {contacts.length === 0 ? "No contacts yet. Add one to get started." : "No contacts match your search."}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([category, items]) => (
            <div key={category}>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{category}</h2>
              <div className="space-y-2">
                {items.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                      className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-semibold shrink-0">
                          {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                          <div className="text-xs text-slate-500">
                            {[c.title, c.organization].filter(Boolean).join(" — ")}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {c.phone && (
                          <span className="hidden sm:inline text-xs text-slate-500">{c.phone}</span>
                        )}
                        <svg
                          className={`w-4 h-4 text-slate-400 transition-transform ${expandedId === c.id ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {expandedId === c.id && (
                      <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/50">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                          {c.email && (
                            <div>
                              <span className="text-xs font-medium text-slate-500">Email</span>
                              <div className="text-slate-900">
                                <a href={`mailto:${c.email}`} className="text-[#1B6B3A] hover:underline">{c.email}</a>
                              </div>
                            </div>
                          )}
                          {c.phone && (
                            <div>
                              <span className="text-xs font-medium text-slate-500">Phone</span>
                              <div className="text-slate-900">
                                <a href={`tel:${c.phone}`} className="text-[#1B6B3A] hover:underline">{c.phone}</a>
                              </div>
                            </div>
                          )}
                          {c.fax && (
                            <div>
                              <span className="text-xs font-medium text-slate-500">Fax</span>
                              <div className="text-slate-900">{c.fax}</div>
                            </div>
                          )}
                          {c.website && (
                            <div>
                              <span className="text-xs font-medium text-slate-500">Website</span>
                              <div className="text-slate-900">{c.website}</div>
                            </div>
                          )}
                          {(c.address_line1 || c.city) && (
                            <div className="sm:col-span-2">
                              <span className="text-xs font-medium text-slate-500">Address</span>
                              <div className="text-slate-900">
                                {c.address_line1}{c.address_line1 && <br />}
                                {[c.city, c.state].filter(Boolean).join(", ")} {c.zip}
                              </div>
                            </div>
                          )}
                          {c.notes && (
                            <div className="sm:col-span-2">
                              <span className="text-xs font-medium text-slate-500">Notes</span>
                              <div className="text-slate-700 whitespace-pre-wrap">{c.notes}</div>
                            </div>
                          )}
                          {c.source && (
                            <div>
                              <span className="text-xs font-medium text-slate-500">Source</span>
                              <div className="text-slate-600 text-xs">{c.source}</div>
                            </div>
                          )}
                          {c.tags.length > 0 && (
                            <div className="sm:col-span-2">
                              <span className="text-xs font-medium text-slate-500">Tags</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {c.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="mt-4 pt-3 border-t border-slate-200 flex justify-between items-center">
                          <span className="text-xs text-slate-400">
                            Added {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          <button
                            onClick={() => handleArchive(c.id)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Archive
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
