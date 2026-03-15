"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScanLine, Loader2, Trash2, Shield, User, Plus, ArrowLeft, X } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/use-auth";
import { cn } from "@/lib/utils";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  created_at: string;
  updated_at: string;
}

export default function AdminPage() {
  const { user, isAdmin } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add form state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleToggleRole = async (u: UserRow) => {
    const newRole = u.role === "admin" ? "user" : "admin";
    await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    fetchUsers();
  };

  const handleDelete = async (u: UserRow) => {
    if (!confirm(`Supprimer ${u.email} ? Cette action est irreversible.`)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Erreur");
      return;
    }
    fetchUsers();
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    setAddLoading(true);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, name: newName, password: newPassword, role: newRole }),
      });

      if (!res.ok) {
        const data = await res.json();
        setAddError(data.error || "Erreur");
        setAddLoading(false);
        return;
      }

      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setNewRole("user");
      setShowAddForm(false);
      fetchUsers();
    } catch {
      setAddError("Erreur reseau");
    } finally {
      setAddLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <p className="text-slate-400">Acces refuse</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink">
      {/* Header */}
      <div className="border-b border-white/10 bg-white/[0.02]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <ScanLine className="w-6 h-6 text-sky-400" />
              <span className="font-display text-lg font-700 bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">
                FloorScan
              </span>
            </Link>
            <span className="text-slate-600">|</span>
            <h1 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-amber-400" /> Administration
            </h1>
          </div>
          <Link href="/demo">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" /> Retour
            </Button>
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Stats bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="glass rounded-lg border border-white/10 px-4 py-2">
              <p className="text-xs text-slate-500">Total utilisateurs</p>
              <p className="text-lg font-display font-700 text-white">{users.length}</p>
            </div>
            <div className="glass rounded-lg border border-white/10 px-4 py-2">
              <p className="text-xs text-slate-500">Admins</p>
              <p className="text-lg font-display font-700 text-amber-400">{users.filter(u => u.role === "admin").length}</p>
            </div>
          </div>
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="w-4 h-4" /> Ajouter un utilisateur
          </Button>
        </div>

        {/* Add user form */}
        {showAddForm && (
          <div className="glass rounded-xl border border-white/10 p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-white">Nouvel utilisateur</p>
              <button onClick={() => setShowAddForm(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nom"
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
              />
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email"
                required
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mot de passe (min. 8 car.)"
                required
                minLength={8}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "user" | "admin")}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500/50"
              >
                <option value="user">Utilisateur</option>
                <option value="admin">Admin</option>
              </select>
              {addError && (
                <div className="col-span-full text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {addError}
                </div>
              )}
              <div className="col-span-full flex justify-end">
                <Button type="submit" disabled={addLoading}>
                  {addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Creer
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Users table */}
        <div className="glass rounded-xl border border-white/10 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-slate-500 font-600 px-5 py-3">Utilisateur</th>
                  <th className="text-left text-xs text-slate-500 font-600 px-5 py-3">Email</th>
                  <th className="text-center text-xs text-slate-500 font-600 px-5 py-3">Role</th>
                  <th className="text-left text-xs text-slate-500 font-600 px-5 py-3">Cree le</th>
                  <th className="text-right text-xs text-slate-500 font-600 px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-700",
                          u.role === "admin" ? "bg-amber-500/20 text-amber-400" : "bg-sky-500/20 text-sky-400"
                        )}>
                          {u.name?.[0]?.toUpperCase() || u.email[0].toUpperCase()}
                        </div>
                        <span className="text-sm text-white font-medium">{u.name || "—"}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-400">{u.email}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider",
                        u.role === "admin"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-slate-500/20 text-slate-400 border border-slate-500/30"
                      )}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500">
                      {new Date(u.created_at).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleToggleRole(u)}
                          disabled={u.id === user?.id}
                          title={u.role === "admin" ? "Retirer admin" : "Promouvoir admin"}
                          className={cn(
                            "p-1.5 rounded-lg border transition-colors",
                            u.id === user?.id
                              ? "border-white/5 text-slate-700 cursor-not-allowed"
                              : u.role === "admin"
                              ? "border-amber-500/20 text-amber-400 hover:bg-amber-500/10"
                              : "border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
                          )}
                        >
                          {u.role === "admin" ? <Shield className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={u.id === user?.id}
                          title="Supprimer"
                          className={cn(
                            "p-1.5 rounded-lg border transition-colors",
                            u.id === user?.id
                              ? "border-white/5 text-slate-700 cursor-not-allowed"
                              : "border-red-500/20 text-red-400 hover:bg-red-500/10"
                          )}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
