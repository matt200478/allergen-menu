// src/App.jsx
import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, Navigate } from 'react-router-dom';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { auth, db } from './firebase/config';

import DishBuilder, {
  UK_ALLERGENS,
  GLUTEN_CEREALS,
} from './components/manager/DishBuilder';
import IngredientManager from './components/manager/IngredientManager';
import CustomerKiosk from './components/kiosk/CustomerKiosk';

import {
  Utensils,
  Package,
  TableProperties,
  ClipboardList,
  ExternalLink,
  LogOut,
  Lock,
  Printer,
  Edit3,
  PlusCircle,
  AlertTriangle,
} from 'lucide-react';

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return (
    <Routes>
      {/* PUBLIC ROUTE: Customer QR Code Kiosk */}
      <Route path="/kiosk" element={<CustomerKiosk />} />

      {/* PROTECTED ROUTE: Manager Dashboard */}
      <Route
        path="/*"
        element={
          authLoading ? (
            <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white text-sm font-bold">
              Initialising Security &amp; Session...
            </div>
          ) : user ? (
            <ManagerDashboard user={user} />
          ) : (
            <ManagerLogin />
          )
        }
      />
    </Routes>
  );
}

/* ============================================================================
 * MANAGER LOGIN SCREEN (Firebase Auth Email/Password)
 * ========================================================================== */
function ManagerLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError('Invalid manager email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto shadow-md">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            Manager Portal Login
          </h1>
          <p className="text-xs text-slate-500">
            Sign in to manage ingredients, GP% margins, and allergen specs.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Manager Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="manager@venue.co.uk"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-600"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-600"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md transition"
          >
            {loading ? 'Signing In...' : 'Sign In to Dashboard'}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-100 text-center">
          <Link
            to="/kiosk"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800"
          >
            <span>Go to Public Customer Allergen Kiosk (/kiosk)</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * PROTECTED MANAGER DASHBOARD SHELL
 * ========================================================================== */
function ManagerDashboard({ user }) {
  const [activeTab, setActiveTab] = useState('INGREDIENTS'); // 'INGREDIENTS' | 'DISH_BUILDER' | 'MATRIX' | 'AUDIT'
  const [editingDish, setEditingDish] = useState(null);
  const [dishes, setDishes] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  // Subscribe to Dishes & Audit Logs for Matrix and Menu Management
  useEffect(() => {
    const unsubDishes = onSnapshot(collection(db, 'dishes'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setDishes(list);
    });

    const qAudit = query(
      collection(db, 'audit_logs'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const unsubAudit = onSnapshot(qAudit, (snap) => {
      setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubDishes();
      unsubAudit();
    };
  }, []);

  const handleEditDish = (dish) => {
    setEditingDish(dish);
    setActiveTab('DISH_BUILDER');
  };

  const handleCreateNewDish = () => {
    setEditingDish(null);
    setActiveTab('DISH_BUILDER');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Manager Navigation Bar (Hidden when printing A4 Matrix) */}
      <header className="bg-slate-900 text-white shadow-md no-print sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-sm">
              FEC
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-base">
                Menu &amp; Allergen Control
              </span>
              <span className="hidden sm:inline-block ml-2 text-xs text-slate-400">
                ({user.email})
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('INGREDIENTS')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeTab === 'INGREDIENTS'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Package className="w-4 h-4" />
              Ingredients &amp; OOS
            </button>

            <button
              type="button"
              onClick={handleCreateNewDish}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeTab === 'DISH_BUILDER'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Utensils className="w-4 h-4" />
              Dish Builder
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('MATRIX')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeTab === 'MATRIX'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <TableProperties className="w-4 h-4" />
              Menu &amp; A4 Matrix ({dishes.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('AUDIT')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeTab === 'AUDIT'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <ClipboardList className="w-4 h-4" />
              Audit Logs
            </button>

            <Link
              to="/kiosk"
              target="_blank"
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 ml-1"
            >
              <span>Live Kiosk</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>

            <button
              type="button"
              onClick={() => signOut(auth)}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </nav>
        </div>
      </header>

      {/* Active Tab Content */}
      <main>
        {activeTab === 'INGREDIENTS' && <IngredientManager />}

        {activeTab === 'DISH_BUILDER' && (
          <DishBuilder
            key={editingDish?.id || 'new-dish'}
            existingDish={editingDish}
            onSaveSuccess={() => setActiveTab('MATRIX')}
          />
        )}

        {activeTab === 'MATRIX' && (
          <PrintableAllergenMatrix
            dishes={dishes}
            onEditDish={handleEditDish}
            onCreateNewDish={handleCreateNewDish}
          />
        )}

        {activeTab === 'AUDIT' && <AuditLogViewer logs={auditLogs} />}
      </main>
    </div>
  );
}

/* ============================================================================
 * FEATURE 4: A4 PRINTABLE ALLERGEN MATRIX & DISH DIRECTORY
 * ========================================================================== */
function PrintableAllergenMatrix({ dishes, onEditDish, onCreateNewDish }) {
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      {/* Screen Controls (Hidden on Print) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 no-print">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            Printable A4 Allergen Matrix &amp; Active Menu
          </h1>
          <p className="text-sm text-slate-600">
            Standard 14-allergen grid formatted for A4 landscape printing. Click any dish to edit its recipe.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCreateNewDish}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-800"
          >
            <PlusCircle className="w-4 h-4 text-indigo-600" />
            New Dish
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm"
          >
            <Printer className="w-4 h-4" />
            Print A4 Allergen Matrix
          </button>
        </div>
      </div>

      {/* Print Header */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">
              Official Food &amp; Beverage Allergen Matrix (14 Major Allergens)
            </h2>
            <p className="text-xs text-slate-500">
              Generated: {new Date().toLocaleDateString('en-GB')} • Key: YES = Contains Allergen | MAY = May Contain Traces | - = Not Present
            </p>
          </div>
        </div>

        {dishes.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            No dishes created yet. Use the Dish Builder tab to create your first menu item.
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2 border border-slate-700 font-bold">Menu Item</th>
                <th className="p-2 border border-slate-700 font-bold text-center">kcal</th>
                {UK_ALLERGENS.map((a) => (
                  <th
                    key={a.key}
                    className="p-1.5 border border-slate-700 font-bold text-center"
                  >
                    {a.label}
                  </th>
                ))}
                <th className="p-2 border border-slate-700 text-center no-print">
                  Edit
                </th>
              </tr>
            </thead>
            <tbody>
              {dishes.map((dish) => {
                const activeCereals = GLUTEN_CEREALS.filter(
                  (c) =>
                    dish.allergens?.[c.key] === 'Yes' ||
                    dish.allergens?.[c.key] === 'May Contain'
                ).map((c) => c.label);

                return (
                  <tr
                    key={dish.id}
                    className="border-b border-slate-200 hover:bg-slate-50"
                  >
                    <td className="p-2 border border-slate-300 font-bold text-slate-900">
                      <div className="flex items-center gap-1.5">
                        <span>{dish.name}</span>
                        {dish.hasOutOfStockIngredient && (
                          <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-black uppercase no-print">
                            OOS
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-normal text-slate-500">
                        {dish.category} • £{Number(dish.retailPrice).toFixed(2)}
                      </div>
                    </td>

                    <td className="p-2 border border-slate-300 text-center font-semibold">
                      {dish.totalCalories || 0}
                    </td>

                    {UK_ALLERGENS.map((a) => {
                      const status = dish.allergens?.[a.key] || 'No';
                      return (
                        <td
                          key={a.key}
                          className={`p-1.5 border border-slate-300 text-center font-bold ${
                            status === 'Yes'
                              ? 'bg-red-600 text-white'
                              : status === 'May Contain'
                              ? 'bg-amber-300 text-slate-950'
                              : 'text-slate-300'
                          }`}
                        >
                          <div>
                            {status === 'Yes'
                              ? 'YES'
                              : status === 'May Contain'
                              ? 'MAY'
                              : '-'}
                          </div>
                          {a.key === 'gluten' && activeCereals.length > 0 && (
                            <div className="text-[9px] font-normal leading-tight mt-0.5">
                              ({activeCereals.join(', ')})
                            </div>
                          )}
                        </td>
                      );
                    })}

                    <td className="p-2 border border-slate-300 text-center no-print">
                      <button
                        type="button"
                        onClick={() => onEditDish(dish)}
                        className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50"
                        title="Edit Dish"
                      >
                        <Edit3 className="w-4 h-4 mx-auto" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * AUDIT LOG VIEWER
 * ========================================================================== */
function AuditLogViewer({ logs }) {
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">
          System Audit Trail
        </h1>
        <p className="text-sm text-slate-600">
          Immutable log of all ingredient allergen updates, stock changes, and recipe edits.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 divide-y divide-slate-200">
        {logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No audit events recorded yet.
          </div>
        ) : (
          logs.map((log) => {
            const dateStr = log.timestamp?.toDate
              ? log.timestamp.toDate().toLocaleString('en-GB')
              : 'Just now';

            return (
              <div
                key={log.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
              >
                <div className="font-semibold text-slate-800">{log.action}</div>
                <div className="text-xs text-slate-500 font-mono shrink-0">
                  {dateStr} • UID: {log.userId?.slice(0, 8)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
