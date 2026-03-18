"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import {
  Users,
  Phone,
  Mail,
  Cake,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Save,
  Shield,
} from "lucide-react";

interface FamilyMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  branch: string | null;
  relation: string | null;
  boardRole: string | null;
  isBoardMember: boolean;
  notes: string | null;
}

const BRANCHES = [
  "Tom's family",
  "Jim's family",
  "Sandy's family",
  "Greg's family",
  "Extended",
];

const BRANCH_COLORS: Record<string, { bg: string; text: string; avatar: string; border: string }> = {
  "Tom's family": { bg: "bg-blue-50", text: "text-blue-700", avatar: "bg-blue-600", border: "border-blue-200" },
  "Jim's family": { bg: "bg-emerald-50", text: "text-emerald-700", avatar: "bg-emerald-600", border: "border-emerald-200" },
  "Sandy's family": { bg: "bg-purple-50", text: "text-purple-700", avatar: "bg-purple-600", border: "border-purple-200" },
  "Greg's family": { bg: "bg-amber-50", text: "text-amber-700", avatar: "bg-amber-600", border: "border-amber-200" },
  "Extended": { bg: "bg-stone-50", text: "text-stone-600", avatar: "bg-stone-500", border: "border-stone-200" },
};

const GENERATIONS = [
  "Founders",
  "Sons",
  "Cousins",
  "Ummm...cousins?",
];

const OFFICER_ROLES = [
  "President",
  "Vice President",
  "Treasurer",
  "Secretary",
];

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  birthday: "",
  branch: "",
  relation: "",
  boardRole: "",
  isBoardMember: false,
  notes: "",
};

export default function FamilyPage() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [grouped, setGrouped] = useState<Record<string, FamilyMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [collapsedBranches, setCollapsedBranches] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    const res = await fetch("/api/family");
    if (res.ok) {
      const data = await res.json();
      setMembers(data.members);
      setGrouped(data.grouped);
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);

    try {
      if (editingId) {
        await fetch(`/api/family/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            birthday: form.birthday.trim() || null,
            branch: form.branch || null,
            relation: form.relation || null,
            boardRole: form.boardRole || null,
            isBoardMember: form.isBoardMember,
            notes: form.notes.trim() || null,
          }),
        });
      } else {
        await fetch("/api/family", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            birthday: form.birthday.trim() || null,
            branch: form.branch || null,
            relation: form.relation || null,
            boardRole: form.boardRole || null,
            isBoardMember: form.isBoardMember,
            notes: form.notes.trim() || null,
          }),
        });
      }

      setForm(emptyForm);
      setShowForm(false);
      setEditingId(null);
      fetchMembers();
    } catch (error) {
      console.error("Save error:", error);
    }

    setSaving(false);
  };

  const startEdit = (member: FamilyMember) => {
    setEditingId(member.id);
    setForm({
      name: member.name,
      email: member.email || "",
      phone: member.phone || "",
      birthday: member.birthday || "",
      branch: member.branch || "",
      relation: member.relation || "",
      boardRole: member.boardRole || "",
      isBoardMember: member.isBoardMember || false,
      notes: member.notes || "",
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteMember = async (id: string) => {
    if (!confirm("Remove this family member?")) return;
    await fetch(`/api/family/${id}`, { method: "DELETE" });
    fetchMembers();
  };

  const cancelForm = () => {
    setForm(emptyForm);
    setShowForm(false);
    setEditingId(null);
  };

  const toggleBranch = (branch: string) => {
    setCollapsedBranches((prev) => ({
      ...prev,
      [branch]: !prev[branch],
    }));
  };

  const branchOrder = BRANCHES.filter((b) => grouped[b]?.length);
  // Include any branches in the data that aren't in BRANCHES
  const otherBranches = Object.keys(grouped).filter((b) => !BRANCHES.includes(b));
  const allBranches = [...branchOrder, ...otherBranches];

  return (
    <div>
      <Header
        title="Family Directory"
        subtitle="Stay connected with the Breadloaf Hill family"
      />

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Add Member Button */}
        {!showForm && (
          <button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              setForm(emptyForm);
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-green-700 text-white px-5 py-2.5 rounded-xl font-medium hover:bg-green-800 transition-colors"
          >
            <UserPlus size={18} />
            Add Family Member
          </button>
        )}

        {/* Add/Edit Form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-stone-800 flex items-center gap-2">
                {editingId ? (
                  <>
                    <Pencil size={16} />
                    Edit Family Member
                  </>
                ) : (
                  <>
                    <UserPlus size={16} />
                    Add Family Member
                  </>
                )}
              </h2>
              <button
                onClick={cancelForm}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Full name"
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">
                  Branch
                </label>
                <select
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                >
                  <option value="">Select branch...</option>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">
                  Generation
                </label>
                <select
                  value={form.relation}
                  onChange={(e) =>
                    setForm({ ...form, relation: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                >
                  <option value="">Select...</option>
                  {GENERATIONS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">
                  Officer Role(s)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {OFFICER_ROLES.map((role) => {
                    const roles = form.boardRole ? form.boardRole.split(", ") : [];
                    const isActive = roles.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => {
                          const updated = isActive
                            ? roles.filter((r) => r !== role)
                            : [...roles, role];
                          setForm({ ...form, boardRole: updated.join(", ") || "" });
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          isActive
                            ? "bg-amber-100 text-amber-700 border-amber-300"
                            : "bg-white text-stone-500 border-stone-200 hover:border-amber-300"
                        }`}
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2 sm:pt-6">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, isBoardMember: !form.isBoardMember })}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    form.isBoardMember
                      ? "bg-indigo-600 border-indigo-600 text-white"
                      : "border-stone-300 hover:border-indigo-400"
                  }`}
                >
                  {form.isBoardMember && <Shield size={12} />}
                </button>
                <label className="text-sm font-medium text-stone-600">Board Member</label>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="name@email.com"
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">
                  Birthday
                </label>
                <input
                  type="text"
                  value={form.birthday}
                  onChange={(e) =>
                    setForm({ ...form, birthday: e.target.value })
                  }
                  placeholder="e.g. March 15"
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-600 mb-1">
                Notes
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Dietary needs, allergies, etc."
                className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSubmit}
                disabled={!form.name.trim() || saving}
                className="inline-flex items-center gap-2 bg-green-700 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                {editingId ? "Save Changes" : "Add Member"}
              </button>
              <button
                onClick={cancelForm}
                className="px-5 py-2.5 rounded-lg text-stone-600 hover:bg-stone-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-stone-100 rounded-xl h-32 animate-pulse" />
            ))}
          </div>
        ) : allBranches.length === 0 ? (
          /* Empty State */
          <div className="text-center py-16">
            <Users size={48} className="mx-auto text-stone-300 mb-3" />
            <p className="text-stone-500 font-medium text-lg">
              No family members yet
            </p>
            <p className="text-stone-400 text-sm mt-1">
              Add the first family member to get started!
            </p>
          </div>
        ) : (
          /* Branch Groups */
          <div className="space-y-6">
            {allBranches.map((branch) => {
              const branchMembers = grouped[branch];
              const colors = BRANCH_COLORS[branch] || BRANCH_COLORS["Extended"];
              const isCollapsed = collapsedBranches[branch];

              return (
                <div key={branch}>
                  <button
                    onClick={() => toggleBranch(branch)}
                    className={`w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl ${colors.bg} ${colors.border} border transition-colors hover:opacity-90`}
                  >
                    <div className="flex items-center gap-2">
                      <Users size={16} className={colors.text} />
                      <h2 className={`font-semibold ${colors.text}`}>
                        {branch}
                      </h2>
                      <span className={`text-sm ${colors.text} opacity-70`}>
                        ({branchMembers.length})
                      </span>
                    </div>
                    {isCollapsed ? (
                      <ChevronDown size={18} className={colors.text} />
                    ) : (
                      <ChevronUp size={18} className={colors.text} />
                    )}
                  </button>

                  {!isCollapsed && (
                    <div className="mt-2 space-y-2">
                      {branchMembers.map((member) => (
                        <MemberCard
                          key={member.id}
                          member={member}
                          colors={colors}
                          onEdit={startEdit}
                          onDelete={deleteMember}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberCard({
  member,
  colors,
  onEdit,
  onDelete,
}: {
  member: FamilyMember;
  colors: { bg: string; text: string; avatar: string; border: string };
  onEdit: (member: FamilyMember) => void;
  onDelete: (id: string) => void;
}) {
  const initials = member.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={`w-11 h-11 rounded-full ${colors.avatar} flex items-center justify-center flex-shrink-0`}
        >
          <span className="text-white font-semibold text-sm">{initials}</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-stone-800">{member.name}</h3>
            {member.isBoardMember && (
              <span className="inline-flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium">
                <Shield size={10} />
                Board
              </span>
            )}
            {member.boardRole && (
              <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                {member.boardRole}
              </span>
            )}
            {member.relation && (
              <span className="text-xs bg-stone-100 text-stone-500 rounded-full px-2 py-0.5 capitalize">
                {member.relation}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {member.phone && (
              <a
                href={`tel:${member.phone.replace(/[^+\d]/g, "")}`}
                className="inline-flex items-center gap-1.5 text-sm text-green-700 hover:text-green-800"
              >
                <Phone size={13} />
                {member.phone}
              </a>
            )}
            {member.email && (
              <a
                href={`mailto:${member.email}`}
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 truncate"
              >
                <Mail size={13} />
                {member.email}
              </a>
            )}
            {member.birthday && (
              <span className="inline-flex items-center gap-1.5 text-sm text-stone-400">
                <Cake size={13} />
                {member.birthday}
              </span>
            )}
          </div>

          {member.notes && (
            <p className="text-xs text-stone-400 mt-1.5">{member.notes}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => onEdit(member)}
            className="p-1.5 rounded-lg text-stone-300 hover:text-stone-600 hover:bg-stone-100 transition-colors"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(member.id)}
            className="p-1.5 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
