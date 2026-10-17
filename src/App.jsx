// src/App.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase/config';

import DishBuilder, {
  UK_ALLERGENS,
  GLUTEN_CEREALS,
  DIETARY_BADGES,
} from './components/manager/DishBuilder';
import IngredientManager, {
  evaluateEhoReviewStatus,
  resolveEffectiveIngredient,
} from './components/manager/IngredientManager';
import AdminSettings, {
  DEFAULT_VENUE_SETTINGS,
} from './components/manager/AdminSettings';
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
  QrCode,
  Copy,
  Check,
  X,
  Trash2,
  TrendingUp,
  AlertTriangle,
  Settings,
  UserCheck,
  Download,
  Search,
  ArrowLeftRight,
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
 * MANAGER LOGIN SCREEN (Firebase Auth Email/Password + Password Reset)
 * ========================================================================== */
function ManagerLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setResetMessage('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError('Invalid manager email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    setResetMessage('');

    if (!email.trim()) {
      setError(
        'Please enter your manager email address above first, then click "Forgot password?".'
      );
      return;
    }

    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetMessage(
        `Password reset link sent to ${email.trim()}. Please check your inbox (and junk folder).`
      );
    } catch (err) {
      if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError(
          'Unable to send reset email. Please verify the email address is registered.'
        );
      }
    } finally {
      setResetLoading(false);
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

        {resetMessage && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800">
            {resetMessage}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="block text-xs font-bold uppercase text-slate-600 mb-1"
            >
              Manager Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="manager@venue.co.uk"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-600"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="login-password"
                className="block text-xs font-bold uppercase text-slate-600"
              >
                Password
              </label>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={resetLoading}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
              >
                {resetLoading ? 'Sending link...' : 'Forgot password?'}
              </button>
            </div>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-600"
            />
          </div>

          <button
            type="submit"
            disabled={loading || resetLoading}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white font-bold text-sm shadow-md transition"
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
  const [activeTab, setActiveTab] = useState('INGREDIENTS');
  const [editingDish, setEditingDish] = useState(null);
  const [dishes, setDishes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [venueSettings, setVenueSettings] = useState(DEFAULT_VENUE_SETTINGS);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  useEffect(() => {
    const unsubDishes = onSnapshot(collection(db, 'dishes'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setDishes(list);
    });

    const unsubIngredients = onSnapshot(
      collection(db, 'ingredients'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setIngredients(list);
      }
    );

    const qAudit = query(
      collection(db, 'audit_logs'),
      orderBy('timestamp', 'desc'),
      limit(100)
    );
    const unsubAudit = onSnapshot(qAudit, (snap) => {
      setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) =>
        (a.displayName || '').localeCompare(b.displayName || '')
      );
      setUsersList(list);
    });

    const unsubSettings = onSnapshot(doc(db, 'settings', 'general'), (snap) => {
      if (snap.exists()) {
        setVenueSettings({ ...DEFAULT_VENUE_SETTINGS, ...snap.data() });
      }
    });

    return () => {
      unsubDishes();
      unsubIngredients();
      unsubAudit();
      unsubUsers();
      unsubSettings();
    };
  }, []);

  // Build O(1) lookup map: UID -> { displayName, role, email }
  const userMap = useMemo(() => {
    const map = {};
    usersList.forEach((u) => {
      map[u.id] = u;
    });
    return map;
  }, [usersList]);

  const currentStaffProfile = userMap[user.uid];
  const currentDisplayName =
    currentStaffProfile?.displayName || user.displayName || user.email;

  const ehoAlertCount = useMemo(() => {
    return ingredients.filter((ing) => {
      const { status } = evaluateEhoReviewStatus(ing.lastVerifiedDate);
      return status === 'OVERDUE' || status === 'DUE_SOON';
    }).length;
  }, [ingredients]);

  const handleEditDish = (dish) => {
    setEditingDish(dish);
    setActiveTab('DISH_BUILDER');
  };

  const handleDuplicateDish = (dish) => {
    const clonedDish = {
      ...dish,
      id: null,
      name: `${dish.name} (Copy)`,
    };
    setEditingDish(clonedDish);
    setActiveTab('DISH_BUILDER');
  };

  const handleCreateNewDish = () => {
    setEditingDish(null);
    setActiveTab('DISH_BUILDER');
  };

  const handleDeleteDish = async (dish) => {
    if (
      !window.confirm(
        `Are you sure you want to permanently delete "${dish.name}" from the menu?`
      )
    ) {
      return;
    }

    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'dishes', dish.id));

      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: `Deleted dish "${dish.name}" from menu`,
        userId: auth.currentUser?.uid || 'manager-session',
        userName: currentDisplayName,
      });

      await batch.commit();
    } catch (error) {
      console.error('Error deleting dish:', error);
      alert(`Failed to delete dish: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Manager Navigation Bar (Hidden when printing) */}
      <header className="bg-slate-900 text-white shadow-md no-print sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-sm">
              FEC
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-base">
                {venueSettings.venueName || 'Menu & Allergen Control'}
              </span>
              <button
                type="button"
                onClick={() => setActiveTab('SETTINGS')}
                className="hidden sm:inline-flex items-center gap-1 ml-2.5 px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-indigo-300 font-semibold transition"
                title="Click to edit your display name"
              >
                <UserCheck className="w-3 h-3" />
                <span>{currentDisplayName}</span>
              </button>
            </div>
          </div>

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
              <span>Ingredients &amp; EHO</span>
              {ehoAlertCount > 0 && (
                <span
                  className="px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black"
                  title={`${ehoAlertCount} ingredient spec(s) due for EHO review`}
                >
                  {ehoAlertCount}
                </span>
              )}
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

            <button
              type="button"
              onClick={() => setActiveTab('SETTINGS')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                activeTab === 'SETTINGS'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Settings className="w-4 h-4" />
              Settings &amp; Users
            </button>

            <button
              type="button"
              onClick={() => setIsQrModalOpen(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-1.5 ml-1 shadow-xs transition"
            >
              <QrCode className="w-4 h-4" />
              <span>QR Stickers</span>
            </button>

            <Link
              to="/kiosk"
              target="_blank"
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
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

      <main className={isQrModalOpen ? 'no-print' : ''}>
        {activeTab === 'INGREDIENTS' && <IngredientManager />}

        {activeTab === 'DISH_BUILDER' && (
          <DishBuilder
            key={editingDish?.id || editingDish?.name || 'new-dish'}
            existingDish={editingDish}
            onSaveSuccess={() => setActiveTab('MATRIX')}
          />
        )}

        {activeTab === 'MATRIX' && (
          <PrintableAllergenMatrix
            dishes={dishes}
            ingredients={ingredients}
            venueSettings={venueSettings}
            onEditDish={handleEditDish}
            onDuplicateDish={handleDuplicateDish}
            onDeleteDish={handleDeleteDish}
            onCreateNewDish={handleCreateNewDish}
          />
        )}

        {activeTab === 'AUDIT' && (
          <AuditLogViewer
            logs={auditLogs}
            userMap={userMap}
            onOpenSettings={() => setActiveTab('SETTINGS')}
          />
        )}

        {activeTab === 'SETTINGS' && (
          <AdminSettings
            currentUser={user}
            usersList={usersList}
            venueSettings={venueSettings}
            auditLogs={auditLogs}
            ingredients={ingredients}
            dishes={dishes}
          />
        )}
      </main>

      {isQrModalOpen && <QrCodeModal onClose={() => setIsQrModalOpen(false)} />}
    </div>
  );
}

/* ============================================================================
 * PRINTABLE QR CODE GENERATOR MODAL (Stickers & Counter Signage)
 * ========================================================================== */
function QrCodeModal({ onClose }) {
  const defaultKioskUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/kiosk`
      : 'https://your-site.netlify.app/kiosk';

  const [kioskUrl, setKioskUrl] = useState(defaultKioskUrl);
  const [headline, setHeadline] = useState('Food & Drink Allergen Guide');
  const [subtext, setSubtext] = useState(
    'Scan to view live menu calories & filter by your allergens'
  );
  const [locationBadge, setLocationBadge] = useState(
    'Bowling Lanes & Soft Play'
  );
  const [layoutMode, setLayoutMode] = useState('GRID_4');
  const [copied, setCopied] = useState(false);

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&format=svg&data=${encodeURIComponent(
    kioskUrl
  )}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(kioskUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const cardCount =
    layoutMode === 'SINGLE' ? 1 : layoutMode === 'GRID_4' ? 4 : 9;
  const cards = Array.from({ length: cardCount });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto print:static print:bg-white print:p-0">
      <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto print:max-h-none print:shadow-none print:border-none print:p-0">
        <div className="no-print space-y-5 pb-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
                <QrCode className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">
                  Customer Kiosk QR Code Generator
                </h2>
                <p className="text-xs text-slate-500">
                  Print QR code stickers or counter signs linking directly to your live /kiosk menu.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="sm:col-span-2">
              <label
                htmlFor="qr-kiosk-url"
                className="block text-xs font-bold uppercase text-slate-600 mb-1"
              >
                Target Kiosk URL
              </label>
              <div className="flex gap-2">
                <input
                  id="qr-kiosk-url"
                  name="qrKioskUrl"
                  type="url"
                  value={kioskUrl}
                  onChange={(e) => setKioskUrl(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold flex items-center gap-1.5 shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy URL
                    </>
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="qr-headline"
                className="block text-xs font-bold uppercase text-slate-600 mb-1"
              >
                Sticker Headline
              </label>
              <input
                id="qr-headline"
                name="qrHeadline"
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold"
              />
            </div>

            <div>
              <label
                htmlFor="qr-location-badge"
                className="block text-xs font-bold uppercase text-slate-600 mb-1"
              >
                Venue / Zone Badge
              </label>
              <input
                id="qr-location-badge"
                name="qrLocationBadge"
                type="text"
                value={locationBadge}
                onChange={(e) => setLocationBadge(e.target.value)}
                placeholder="e.g. Table & Lane Service"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="qr-subtext"
                className="block text-xs font-bold uppercase text-slate-600 mb-1"
              >
                Call-to-Action Subtext
              </label>
              <input
                id="qr-subtext"
                name="qrSubtext"
                type="text"
                value={subtext}
                onChange={(e) => setSubtext(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase text-slate-500 mr-1">
                Print Layout:
              </span>
              {[
                { id: 'SINGLE', label: '1x Counter Sign' },
                { id: 'GRID_4', label: '4x Table Talkers (2×2)' },
                { id: 'GRID_9', label: '9x Lane Stickers (3×3)' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLayoutMode(opt.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                    layoutMode === opt.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-md transition"
            >
              <Printer className="w-4 h-4" />
              Print QR Sheet
            </button>
          </div>
        </div>

        <div className="pt-6 print:pt-0">
          <div
            className={`grid gap-4 ${
              layoutMode === 'SINGLE'
                ? 'grid-cols-1 max-w-md mx-auto'
                : layoutMode === 'GRID_4'
                ? 'grid-cols-2'
                : 'grid-cols-3'
            }`}
          >
            {cards.map((_, idx) => (
              <div
                key={idx}
                className={`border-2 border-slate-900 rounded-2xl text-center flex flex-col items-center justify-between bg-white ${
                  layoutMode === 'SINGLE'
                    ? 'p-8 space-y-5'
                    : layoutMode === 'GRID_4'
                    ? 'p-5 space-y-3'
                    : 'p-3.5 space-y-2'
                }`}
              >
                {locationBadge && (
                  <span className="px-3 py-1 rounded-full bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">
                    {locationBadge}
                  </span>
                )}

                <h3
                  className={`font-black text-slate-900 leading-tight ${
                    layoutMode === 'SINGLE'
                      ? 'text-2xl'
                      : layoutMode === 'GRID_4'
                      ? 'text-lg'
                      : 'text-sm'
                  }`}
                >
                  {headline}
                </h3>

                <div className="p-2 bg-white border-2 border-slate-200 rounded-xl inline-block">
                  <img
                    src={qrImageUrl}
                    alt="Customer Allergen Kiosk QR Code"
                    className={
                      layoutMode === 'SINGLE'
                        ? 'w-56 h-56'
                        : layoutMode === 'GRID_4'
                        ? 'w-36 h-36'
                        : 'w-24 h-24'
                    }
                  />
                </div>

                <p
                  className={`text-slate-700 font-semibold max-w-xs ${
                    layoutMode === 'GRID_9' ? 'text-[10px]' : 'text-xs'
                  }`}
                >
                  {subtext}
                </p>

                <div className="text-[10px] font-mono text-slate-400 truncate max-w-full">
                  {kioskUrl.replace(/^https?:\/\//, '')}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * FEATURE 4: A4 PRINTABLE ALLERGEN MATRIX, LIVE GP%, CLONING & BACKUP SWAPS
 * ========================================================================== */
function PrintableAllergenMatrix({
  dishes,
  ingredients,
  venueSettings = DEFAULT_VENUE_SETTINGS,
  onEditDish,
  onDuplicateDish,
  onDeleteDish,
  onCreateNewDish,
}) {
  const [deductVat, setDeductVat] = useState(false);
  const targetGp = Number(venueSettings?.targetGpPercentage) || 70;
  const vatDivisor = 1 + (Number(venueSettings?.vatPercentage) || 20) / 100;

  const ingredientMap = useMemo(() => {
    const map = {};
    (ingredients || []).forEach((ing) => {
      map[ing.id] = ing;
    });
    return map;
  }, [ingredients]);

  // Calculate live cost, GP%, and active backup substitutions dynamically
  const enrichedDishes = useMemo(() => {
    return dishes.map((dish) => {
      let liveCost = 0;
      const liveSwaps = [];

      (dish.components || []).forEach((comp) => {
        const { effectiveIng, isSwapped, primary, backup } =
          resolveEffectiveIngredient(comp.ingredientId, ingredientMap);
        const weight = parseFloat(comp.weightGrams) || 0;

        if (effectiveIng && weight > 0) {
          const costPerGram =
            (Number(effectiveIng.costPerPack) || 0) /
            (Number(effectiveIng.packWeightGrams) || 1);
          liveCost += costPerGram * weight;
        }

        if (isSwapped && primary && backup) {
          liveSwaps.push({
            primaryName: primary.productName,
            backupName: backup.productName,
          });
        }
      });

      const retail = parseFloat(dish.retailPrice) || 0;
      const effectiveRev = deductVat ? retail / vatDivisor : retail;
      const gpPercent =
        effectiveRev > 0 ? ((effectiveRev - liveCost) / effectiveRev) * 100 : 0;

      return {
        ...dish,
        liveCost,
        gpPercent,
        liveSwaps:
          liveSwaps.length > 0 ? liveSwaps : dish.activeSubstitutions || [],
      };
    });
  }, [dishes, ingredientMap, deductVat, vatDivisor]);

  const menuStats = useMemo(() => {
    if (enrichedDishes.length === 0) return { avgGp: 0, lowGpCount: 0 };
    const totalGp = enrichedDishes.reduce((acc, d) => acc + d.gpPercent, 0);
    const lowGpCount = enrichedDishes.filter(
      (d) => d.gpPercent < targetGp
    ).length;
    return {
      avgGp: totalGp / enrichedDishes.length,
      lowGpCount,
    };
  }, [enrichedDishes, targetGp]);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 no-print">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            Menu Profitability &amp; A4 Allergen Matrix
          </h1>
          <p className="text-sm text-slate-600">
            Live GP% margin tracking (Target: {targetGp}%), dietary tags, active backup swaps, and A4 landscape allergen printing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="matrix-vat-toggle"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 cursor-pointer"
          >
            <input
              id="matrix-vat-toggle"
              name="matrixVatToggle"
              type="checkbox"
              checked={deductVat}
              onChange={(e) => setDeductVat(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Deduct {venueSettings?.vatPercentage || 20}% VAT on GP%
          </label>

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

      {enrichedDishes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 no-print">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase text-slate-500">
                Active Menu Dishes
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-0.5">
                {enrichedDishes.length}
              </div>
            </div>
            <Utensils className="w-8 h-8 text-slate-300" />
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase text-slate-500">
                Average Menu GP% ({deductVat ? 'Net ex-VAT' : 'Gross'})
              </div>
              <div
                className={`text-2xl font-extrabold mt-0.5 ${
                  menuStats.avgGp >= targetGp
                    ? 'text-emerald-600'
                    : 'text-amber-600'
                }`}
              >
                {menuStats.avgGp.toFixed(1)}%
              </div>
            </div>
            <TrendingUp className="w-8 h-8 text-emerald-500/40" />
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase text-slate-500">
                Dishes Below {targetGp}% GP Target
              </div>
              <div
                className={`text-2xl font-extrabold mt-0.5 ${
                  menuStats.lowGpCount > 0
                    ? 'text-red-600'
                    : 'text-emerald-600'
                }`}
              >
                {menuStats.lowGpCount}
              </div>
            </div>
            <AlertTriangle
              className={`w-8 h-8 ${
                menuStats.lowGpCount > 0
                  ? 'text-red-500/50'
                  : 'text-slate-200'
              }`}
            />
          </div>
        </div>
      )}

      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">
              {venueSettings?.venueName
                ? `${venueSettings.venueName} — Official Allergen Matrix`
                : 'Official Food & Beverage Allergen Matrix (14 Major Allergens)'}
            </h2>
            <p className="text-xs text-slate-500">
              Generated: {new Date().toLocaleDateString('en-GB')} • Key: YES = Contains Allergen | MAY = May Contain Traces | - = Not Present
            </p>
          </div>
        </div>

        {enrichedDishes.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            No dishes created yet. Use the Dish Builder tab to create your first menu item.
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2 border border-slate-700 font-bold">
                  Menu Item
                </th>
                <th className="p-2 border border-slate-700 font-bold text-center">
                  kcal
                </th>
                <th className="p-2 border border-slate-700 font-bold text-center no-print bg-indigo-950">
                  Cost / GP%
                </th>
                {UK_ALLERGENS.map((a) => (
                  <th
                    key={a.key}
                    className="p-1.5 border border-slate-700 font-bold text-center"
                  >
                    {a.label}
                  </th>
                ))}
                <th className="p-2 border border-slate-700 text-center no-print">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {enrichedDishes.map((dish) => {
                const activeCereals = GLUTEN_CEREALS.filter(
                  (c) =>
                    dish.allergens?.[c.key] === 'Yes' ||
                    dish.allergens?.[c.key] === 'May Contain'
                ).map((c) => c.label);

                const activeDietary = DIETARY_BADGES.filter((b) =>
                  (dish.dietaryTags || []).includes(b.key)
                );

                const gpBadgeColour =
                  dish.gpPercent >= targetGp
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : dish.gpPercent >= targetGp - 10
                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                    : 'bg-red-100 text-red-800 border-red-300';

                return (
                  <tr
                    key={dish.id}
                    className="border-b border-slate-200 hover:bg-slate-50"
                  >
                    <td className="p-2 border border-slate-300 font-bold text-slate-900">
                      <div className="flex flex-wrap items-center gap-1">
                        <span>{dish.name}</span>
                        {activeDietary.map((b) => (
                          <span
                            key={b.key}
                            className={`px-1.5 py-0.2 rounded text-[9px] font-black border ${b.pillClass}`}
                          >
                            {b.short}
                          </span>
                        ))}
                        {!dish.isActive && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[9px] font-bold uppercase no-print">
                            Hidden
                          </span>
                        )}
                        {dish.liveSwaps?.length > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-black uppercase no-print"
                            title={dish.liveSwaps
                              .map((s) => `${s.primaryName} → ${s.backupName}`)
                              .join(', ')}
                          >
                            <ArrowLeftRight className="w-2.5 h-2.5" />
                            SWAP ACTIVE
                          </span>
                        )}
                        {dish.hasOutOfStockIngredient && (
                          <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-black uppercase no-print">
                            OOS
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-normal text-slate-500">
                        {dish.category} • Retail: £
                        {Number(dish.retailPrice).toFixed(2)}
                      </div>
                    </td>

                    <td className="p-2 border border-slate-300 text-center font-semibold">
                      {dish.totalCalories || 0}
                    </td>

                    <td className="p-2 border border-slate-300 text-center no-print">
                      <div className="font-bold text-slate-800">
                        £{dish.liveCost.toFixed(2)}
                      </div>
                      <span
                        className={`inline-block mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-extrabold ${gpBadgeColour}`}
                      >
                        {dish.gpPercent.toFixed(1)}% GP
                      </span>
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
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEditDish(dish)}
                          className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 transition"
                          title="Edit Dish"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onDuplicateDish(dish)}
                          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition"
                          title="Duplicate / Clone Dish into Dish Builder"
                        >
                          <Copy className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onDeleteDish(dish)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                          title="Delete Dish"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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
 * UPGRADED AUDIT LOG VIEWER (Resolves Staff Names, Roles, Search & CSV Export)
 * ========================================================================== */
function AuditLogViewer({ logs, userMap = {}, onOpenSettings }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserFilter, setSelectedUserFilter] = useState('ALL');

  const resolveLogStaff = (log) => {
    const mapped = userMap[log.userId];
    if (mapped?.displayName) {
      return {
        name: mapped.displayName,
        role: mapped.role || 'Manager',
        isMapped: true,
      };
    }
    if (log.userName) {
      return {
        name: log.userName,
        role: 'Manager',
        isMapped: true,
      };
    }
    return {
      name: `UID: ${log.userId?.slice(0, 8) || 'System'}`,
      role: null,
      isMapped: false,
    };
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const staff = resolveLogStaff(log);
      const matchesUser =
        selectedUserFilter === 'ALL' || log.userId === selectedUserFilter;
      const matchesSearch =
        !searchQuery.trim() ||
        log.action?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        staff.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesUser && matchesSearch;
    });
  }, [logs, userMap, searchQuery, selectedUserFilter]);

  const handleExportAuditCsv = () => {
    if (filteredLogs.length === 0) return;
    const rows = ['Timestamp,Staff Name,Role,Action,UID'];
    filteredLogs.forEach((log) => {
      const dateStr = log.timestamp?.toDate
        ? log.timestamp.toDate().toLocaleString('en-GB')
        : 'Just now';
      const staff = resolveLogStaff(log);
      const safeAction = `"${(log.action || '').replace(/"/g, '""')}"`;
      rows.push(
        `"${dateStr}","${staff.name}","${staff.role || ''}",${safeAction},"${
          log.userId || ''
        }"`
      );
    });

    const blob = new Blob([rows.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `fec-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            System Audit Trail
          </h1>
          <p className="text-sm text-slate-600">
            Immutable log of all ingredient allergen updates, backup swaps, EHO 90-day spec verifications, and recipe edits.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700"
          >
            Manage Staff Names
          </button>
          <button
            type="button"
            onClick={handleExportAuditCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Export Audit CSV
          </button>
        </div>
      </div>

      {/* Search & Staff Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <label htmlFor="audit-search" className="sr-only">
            Search audit logs
          </label>
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
          <input
            id="audit-search"
            name="auditSearch"
            type="text"
            placeholder="Search audit actions or staff name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-medium"
          />
        </div>

        <select
          id="audit-staff-filter"
          name="auditStaffFilter"
          value={selectedUserFilter}
          onChange={(e) => setSelectedUserFilter(e.target.value)}
          className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700"
        >
          <option value="ALL">All Staff Members</option>
          {Object.values(userMap).map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.role || 'Manager'})
            </option>
          ))}
        </select>
      </div>

      {/* Audit Entries List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 divide-y divide-slate-200">
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No matching audit events found.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const dateStr = log.timestamp?.toDate
              ? log.timestamp.toDate().toLocaleString('en-GB')
              : 'Just now';
            const staff = resolveLogStaff(log);

            return (
              <div
                key={log.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm hover:bg-slate-50/80"
              >
                <div className="font-semibold text-slate-800">{log.action}</div>

                <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
                  <span className="text-slate-500 font-mono">{dateStr}</span>
                  <span className="text-slate-300">•</span>

                  {staff.isMapped ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-900 border border-indigo-200 font-bold">
                      <UserCheck className="w-3 h-3 text-indigo-600" />
                      <span>{staff.name}</span>
                      {staff.role && (
                        <span className="text-[10px] font-normal text-indigo-600">
                          ({staff.role})
                        </span>
                      )}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="px-2.5 py-0.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-mono font-bold transition"
                      title="Click to assign a staff name to this UID in Settings"
                    >
                      {staff.name} (Click to name)
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
