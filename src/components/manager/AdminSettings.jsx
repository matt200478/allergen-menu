// src/components/manager/AdminSettings.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import {
  Users,
  UserPlus,
  Building2,
  Sliders,
  ShieldCheck,
  Mail,
  Save,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  Download,
  Plus,
  X,
  UserCheck,
} from 'lucide-react';

const STAFF_ROLES = [
  'Admin / Area Manager',
  'Centre Manager',
  'Kitchen Manager',
  'Duty Manager',
  'Team Leader',
];

export const DEFAULT_VENUE_SETTINGS = {
  venueName: 'Family Entertainment Centre',
  targetGpPercentage: 70,
  vatPercentage: 20,
  ehoReviewDays: 90,
  kioskSafetyNotice:
    'Our kitchen handles multiple allergens. Always inform a team member of any food allergies before ordering.',
  categories: [
    'Burgers & Hot Dogs',
    'Sharing Platters & Bowling Bites',
    'Pizzas',
    'Kids Soft Play Meals',
    'Sides & Loaded Fries',
    'Desserts & Slushies',
    'Hot & Cold Drinks',
  ],
};

export default function AdminSettings({
  currentUser,
  usersList = [],
  venueSettings = DEFAULT_VENUE_SETTINGS,
  auditLogs = [],
  ingredients = [],
  dishes = [],
}) {
  // 1. Current Logged-in User Profile State
  const existingCurrentProfile = useMemo(
    () => usersList.find((u) => u.id === currentUser?.uid),
    [usersList, currentUser]
  );

  const [myDisplayName, setMyDisplayName] = useState(
    existingCurrentProfile?.displayName || currentUser?.displayName || ''
  );
  const [myRole, setMyRole] = useState(
    existingCurrentProfile?.role || STAFF_ROLES[0]
  );

  useEffect(() => {
    if (existingCurrentProfile) {
      setMyDisplayName(existingCurrentProfile.displayName || '');
      setMyRole(existingCurrentProfile.role || STAFF_ROLES[0]);
    }
  }, [existingCurrentProfile]);

  // 2. Create New Staff User Form State
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffRole, setNewStaffRole] = useState(STAFF_ROLES[1]);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // 3. Inline Edit Existing / Historical UID User State
  const [editingUserId, setEditingUserId] = useState(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserRole, setEditUserRole] = useState(STAFF_ROLES[1]);

  // 4. Venue & Operational Settings State
  const [settingsForm, setSettingsForm] = useState({
    ...DEFAULT_VENUE_SETTINGS,
    ...venueSettings,
  });
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Feedback Banner State
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (venueSettings) {
      setSettingsForm((prev) => ({
        ...prev,
        ...venueSettings,
        categories:
          venueSettings.categories?.length > 0
            ? venueSettings.categories
            : DEFAULT_VENUE_SETTINGS.categories,
      }));
    }
  }, [venueSettings]);

  // Detect any historical UIDs in audit_logs that haven't been assigned a name yet
  const unmappedUids = useMemo(() => {
    const knownUids = new Set(usersList.map((u) => u.id));
    const unknown = new Set();
    auditLogs.forEach((log) => {
      if (
        log.userId &&
        log.userId !== 'manager-session' &&
        !knownUids.has(log.userId)
      ) {
        unknown.add(log.userId);
      }
    });
    return Array.from(unknown);
  }, [usersList, auditLogs]);

  // Save Current User's Display Name & Role (Immediately resolves UID in all past & future logs)
  const handleSaveMyProfile = async (e) => {
    e.preventDefault();
    if (!myDisplayName.trim() || !currentUser) return;

    try {
      await updateProfile(currentUser, { displayName: myDisplayName.trim() });

      const batch = writeBatch(db);
      batch.set(
        doc(db, 'users', currentUser.uid),
        {
          uid: currentUser.uid,
          displayName: myDisplayName.trim(),
          email: currentUser.email,
          role: myRole,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: `Updated staff profile name to "${myDisplayName.trim()}" (${myRole})`,
        userId: currentUser.uid,
        userName: myDisplayName.trim(),
      });

      await batch.commit();

      setFeedback({
        type: 'success',
        text: `Your profile name ("${myDisplayName.trim()}") is now active across all past and future audit logs.`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: `Could not update profile: ${error.message}`,
      });
    }
  };

  // Create a brand-new Firebase Auth Staff Account WITHOUT logging out the current admin
  const handleCreateStaffAccount = async (e) => {
    e.preventDefault();
    setFeedback(null);

    if (newStaffPassword.length < 6) {
      setFeedback({
        type: 'error',
        text: 'Temporary password must be at least 6 characters.',
      });
      return;
    }

    setIsCreatingUser(true);
    const secondaryAppName = `StaffCreator_${Date.now()}`;
    let secondaryApp = null;

    try {
      // Spin up isolated Firebase App instance using existing project credentials
      secondaryApp = initializeApp(auth.app.options, secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);

      const userCred = await createUserWithEmailAndPassword(
        secondaryAuth,
        newStaffEmail.trim(),
        newStaffPassword
      );

      await updateProfile(userCred.user, {
        displayName: newStaffName.trim(),
      });

      // Sign out of secondary instance immediately
      await firebaseSignOut(secondaryAuth);

      // Write new staff member's profile to Firestore using main authenticated session
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', userCred.user.uid), {
        uid: userCred.user.uid,
        displayName: newStaffName.trim(),
        email: newStaffEmail.trim().toLowerCase(),
        role: newStaffRole,
        createdAt: serverTimestamp(),
        createdBy: currentUser?.uid || null,
      });

      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: `Created new staff user account: "${newStaffName.trim()}" (${newStaffRole} - ${newStaffEmail.trim()})`,
        userId: currentUser?.uid || 'manager-session',
        userName: myDisplayName || currentUser?.email || 'Admin',
      });

      await batch.commit();

      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('');
      setFeedback({
        type: 'success',
        text: `Created account for ${newStaffName.trim()} (${newStaffEmail.trim()}). They can now sign in.`,
      });
    } catch (error) {
      console.error('Error creating staff user:', error);
      let msg = error.message;
      if (error.code === 'auth/email-already-in-use') {
        msg = 'That email address is already registered in Firebase Authentication.';
      }
      setFeedback({ type: 'error', text: `Failed to create user: ${msg}` });
    } finally {
      if (secondaryApp) {
        await deleteApp(secondaryApp);
      }
      setIsCreatingUser(false);
    }
  };

  // Save edited name/role for any existing staff member or historical UID
  const handleSaveEditedUser = async (targetUid, existingEmail = '') => {
    if (!editUserName.trim()) return;

    try {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'users', targetUid),
        {
          uid: targetUid,
          displayName: editUserName.trim(),
          email: existingEmail || 'Assigned via UID',
          role: editUserRole,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: `Assigned name "${editUserName.trim()}" (${editUserRole}) to UID ${targetUid.slice(
          0,
          8
        )}`,
        userId: currentUser?.uid || 'manager-session',
        userName: myDisplayName || currentUser?.email || 'Admin',
      });

      await batch.commit();
      setEditingUserId(null);
      setFeedback({
        type: 'success',
        text: `Updated staff profile for "${editUserName.trim()}". All matching audit logs now display their name.`,
      });
    } catch (error) {
      setFeedback({ type: 'error', text: error.message });
    }
  };

  // Send Password Reset Email to a Staff Member
  const handleSendPasswordReset = async (staffEmail, staffName) => {
    if (!staffEmail || !staffEmail.includes('@')) {
      setFeedback({
        type: 'error',
        text: 'No valid email address on file for this user.',
      });
      return;
    }

    try {
      await sendPasswordResetEmail(auth, staffEmail);
      setFeedback({
        type: 'success',
        text: `Password reset email sent to ${staffName} (${staffEmail}).`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: `Failed to send reset email: ${error.message}`,
      });
    }
  };

  // Remove Staff Profile from Directory
  const handleRemoveUserDirectoryEntry = async (staffUser) => {
    if (staffUser.id === currentUser?.uid) {
      setFeedback({
        type: 'error',
        text: 'You cannot remove your own active profile.',
      });
      return;
    }
    if (
      !window.confirm(
        `Remove "${staffUser.displayName}" from the staff directory?`
      )
    ) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'users', staffUser.id));
      setFeedback({
        type: 'success',
        text: `Removed "${staffUser.displayName}" from directory.`,
      });
    } catch (error) {
      setFeedback({ type: 'error', text: error.message });
    }
  };

  // Category Management Handlers
  const handleAddCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    if (settingsForm.categories.includes(trimmed)) {
      setNewCategoryInput('');
      return;
    }
    setSettingsForm((prev) => ({
      ...prev,
      categories: [...prev.categories, trimmed],
    }));
    setNewCategoryInput('');
  };

  const handleRemoveCategory = (catToRemove) => {
    if (settingsForm.categories.length <= 1) return;
    setSettingsForm((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c !== catToRemove),
    }));
  };

  // Save Venue, Financial & Compliance Settings
  const handleSaveVenueSettings = async (e) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setFeedback(null);

    try {
      const batch = writeBatch(db);
      const settingsRef = doc(db, 'settings', 'general');

      const payload = {
        venueName: settingsForm.venueName.trim() || 'Family Entertainment Centre',
        targetGpPercentage: Number(settingsForm.targetGpPercentage) || 70,
        vatPercentage: Number(settingsForm.vatPercentage) || 20,
        ehoReviewDays: Number(settingsForm.ehoReviewDays) || 90,
        kioskSafetyNotice: settingsForm.kioskSafetyNotice.trim(),
        categories: settingsForm.categories,
        updatedAt: serverTimestamp(),
      };

      batch.set(settingsRef, payload, { merge: true });

      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: `Updated venue & system settings (${payload.venueName}, Target GP: ${payload.targetGpPercentage}%, EHO Cycle: ${payload.ehoReviewDays}d)`,
        userId: currentUser?.uid || 'manager-session',
        userName: myDisplayName || currentUser?.email || 'Admin',
      });

      await batch.commit();

      setFeedback({
        type: 'success',
        text: 'Venue branding, GP% targets, EHO review cycle, and menu categories saved.',
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: `Failed to save settings: ${error.message}`,
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Export Complete System Backup as JSON
  const handleExportFullBackupJson = () => {
    const backupPayload = {
      exportedAt: new Date().toISOString(),
      venueSettings: settingsForm,
      users: usersList,
      ingredients,
      dishes,
      recentAuditLogs: auditLogs,
    };

    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.setAttribute('download', `fec-full-system-backup-${dateStamp}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 text-slate-900">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">
            Admin, Staff &amp; Venue Settings
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Manage staff accounts, map audit UIDs to real names, and configure GP% targets, EHO cycles, and Kiosk branding.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportFullBackupJson}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition shrink-0"
        >
          <Download className="w-4 h-4" />
          Download Full System Backup (.JSON)
        </button>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-300 text-red-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2.5 text-sm font-medium">
            {feedback.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-bold underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Staff Accounts & UID Mapping (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card 1: Your Active Profile (Maps current UID e.g. PpVTL9cP immediately) */}
          <form
            onSubmit={handleSaveMyProfile}
            className="bg-indigo-50/70 border-2 border-indigo-200 rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <UserCheck className="w-5 h-5 text-indigo-600" />
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">
                    Your Profile &amp; Audit Name
                  </h2>
                  <p className="text-xs text-slate-600">
                    Logged in as <strong>{currentUser?.email}</strong> (UID:{' '}
                    <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-indigo-200">
                      {currentUser?.uid?.slice(0, 8)}
                    </code>
                    )
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5">
                <label
                  htmlFor="my-display-name"
                  className="block text-xs font-bold uppercase text-slate-700 mb-1"
                >
                  Your Full Name *
                </label>
                <input
                  id="my-display-name"
                  name="myDisplayName"
                  type="text"
                  required
                  placeholder="e.g. Matt Scotney"
                  value={myDisplayName}
                  onChange={(e) => setMyDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold"
                />
              </div>

              <div className="sm:col-span-4">
                <label
                  htmlFor="my-role"
                  className="block text-xs font-bold uppercase text-slate-700 mb-1"
                >
                  Job Role
                </label>
                <select
                  id="my-role"
                  name="myRole"
                  value={myRole}
                  onChange={(e) => setMyRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold"
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <button
                  type="submit"
                  className="w-full py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-xs transition flex items-center justify-center gap-1.5 h-[38px]"
                >
                  <Save className="w-4 h-4" />
                  Save My Name
                </button>
              </div>
            </div>
          </form>

          {/* Card 2: Add New Staff Account */}
          <form
            onSubmit={handleCreateStaffAccount}
            className="bg-white rounded-2xl shadow-xs border border-slate-200 p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-emerald-600" />
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Add New Staff / Manager Account
                </h2>
                <p className="text-xs text-slate-500">
                  Creates a Firebase Authentication login and links their full name to the Audit Trail without signing you out.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="new-staff-name"
                  className="block text-xs font-bold uppercase text-slate-600 mb-1"
                >
                  Staff Full Name *
                </label>
                <input
                  id="new-staff-name"
                  name="newStaffName"
                  type="text"
                  required
                  placeholder="e.g. Sarah Jenkins"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-medium"
                />
              </div>

              <div>
                <label
                  htmlFor="new-staff-role"
                  className="block text-xs font-bold uppercase text-slate-600 mb-1"
                >
                  Assigned Role *
                </label>
                <select
                  id="new-staff-role"
                  name="newStaffRole"
                  value={newStaffRole}
                  onChange={(e) => setNewStaffRole(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-medium"
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="new-staff-email"
                  className="block text-xs font-bold uppercase text-slate-600 mb-1"
                >
                  Email Address (Login ID) *
                </label>
                <input
                  id="new-staff-email"
                  name="newStaffEmail"
                  type="email"
                  autoComplete="off"
                  required
                  placeholder="sarah@venue.co.uk"
                  value={newStaffEmail}
                  onChange={(e) => setNewStaffEmail(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label
                  htmlFor="new-staff-password"
                  className="block text-xs font-bold uppercase text-slate-600 mb-1"
                >
                  Temporary Password (Min 6 chars) *
                </label>
                <input
                  id="new-staff-password"
                  name="newStaffPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={newStaffPassword}
                  onChange={(e) => setNewStaffPassword(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isCreatingUser}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white text-xs font-extrabold shadow-xs transition"
              >
                <UserPlus className="w-4 h-4" />
                {isCreatingUser
                  ? 'Creating Account...'
                  : 'Create Staff Login & Assign Name'}
              </button>
            </div>
          </form>

          {/* Card 3: Staff Directory & Historical UID Mapper */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Registered Staff Directory ({usersList.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    All audit log actions automatically match against these staff profiles.
                  </p>
                </div>
              </div>
            </div>

            {/* Unmapped Historical UIDs Notice (if any exist in audit_logs) */}
            {unmappedUids.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
                <div className="text-xs font-extrabold text-amber-950 uppercase">
                  Unassigned Audit Log UIDs Found ({unmappedUids.length})
                </div>
                <p className="text-xs text-amber-900">
                  These UIDs appear in older audit logs without a staff name assigned. Click <strong>Assign Name</strong> to label them retroactively:
                </p>
                <div className="space-y-2 pt-1">
                  {unmappedUids.map((uid) => (
                    <div
                      key={uid}
                      className="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-lg border border-amber-200 text-xs"
                    >
                      <span className="font-mono font-bold text-slate-700">
                        UID: {uid.slice(0, 8)} ({uid})
                      </span>
                      {editingUserId === uid ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            id={`assign-uid-name-${uid}`}
                            name="assignUidName"
                            type="text"
                            placeholder="Staff Name"
                            value={editUserName}
                            onChange={(e) => setEditUserName(e.target.value)}
                            className="px-2.5 py-1 rounded border border-slate-300 text-xs font-bold"
                          />
                          <select
                            id={`assign-uid-role-${uid}`}
                            name="assignUidRole"
                            value={editUserRole}
                            onChange={(e) => setEditUserRole(e.target.value)}
                            className="px-2 py-1 rounded border border-slate-300 text-xs"
                          >
                            {STAFF_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleSaveEditedUser(uid)}
                            className="px-3 py-1 rounded bg-emerald-600 text-white font-bold"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingUserId(null)}
                            className="px-2 py-1 text-slate-500"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUserId(uid);
                            setEditUserName('');
                            setEditUserRole(STAFF_ROLES[0]);
                          }}
                          className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold"
                        >
                          Assign Name
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Registered Staff Table */}
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {usersList.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No staff profiles saved yet. Save your name in the box at the top to register your profile.
                </div>
              ) : (
                usersList.map((staff) => (
                  <div
                    key={staff.id}
                    className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white hover:bg-slate-50 text-sm"
                  >
                    {editingUserId === staff.id ? (
                      <div className="flex flex-wrap items-center gap-2 w-full">
                        <input
                          id={`edit-staff-name-${staff.id}`}
                          name="editStaffName"
                          type="text"
                          value={editUserName}
                          onChange={(e) => setEditUserName(e.target.value)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold flex-1"
                        />
                        <select
                          id={`edit-staff-role-${staff.id}`}
                          name="editStaffRole"
                          value={editUserRole}
                          onChange={(e) => setEditUserRole(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold bg-white"
                        >
                          {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            handleSaveEditedUser(staff.id, staff.email)
                          }
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingUserId(null)}
                          className="px-2.5 py-1.5 text-xs text-slate-500"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-2">
                            <span>{staff.displayName}</span>
                            <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-extrabold uppercase">
                              {staff.role || 'Manager'}
                            </span>
                            {staff.id === currentUser?.uid && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {staff.email} • UID:{' '}
                            <span className="font-mono">
                              {staff.id.slice(0, 8)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {staff.email && staff.email.includes('@') && (
                            <button
                              type="button"
                              onClick={() =>
                                handleSendPasswordReset(
                                  staff.email,
                                  staff.displayName
                                )
                              }
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center gap-1"
                              title="Send password reset email"
                            >
                              <Mail className="w-3.5 h-3.5 text-slate-500" />
                              Reset Password
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setEditingUserId(staff.id);
                              setEditUserName(staff.displayName || '');
                              setEditUserRole(staff.role || STAFF_ROLES[1]);
                            }}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100"
                            title="Edit Name or Role"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {staff.id !== currentUser?.uid && (
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveUserDirectoryEntry(staff)
                              }
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                              title="Remove from Directory"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Venue Branding, GP% Targets & Categories (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          <form
            onSubmit={handleSaveVenueSettings}
            className="bg-white rounded-2xl shadow-xs border border-slate-200 p-5 space-y-5"
          >
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" />
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Venue, Financial &amp; EHO Settings
                </h2>
                <p className="text-xs text-slate-500">
                  Applied live across the Manager Dashboard, A4 Matrix, and Customer Kiosk.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="setting-venue-name"
                  className="block text-xs font-bold uppercase text-slate-600 mb-1"
                >
                  Venue / Centre Name *
                </label>
                <input
                  id="setting-venue-name"
                  name="venueName"
                  type="text"
                  required
                  value={settingsForm.venueName}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      venueName: e.target.value,
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-bold"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="setting-target-gp"
                    className="block text-[11px] font-bold uppercase text-slate-600 mb-1"
                  >
                    Target GP (%)
                  </label>
                  <input
                    id="setting-target-gp"
                    name="targetGpPercentage"
                    type="number"
                    min="1"
                    max="99"
                    value={settingsForm.targetGpPercentage}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        targetGpPercentage: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-extrabold text-emerald-700"
                  />
                </div>

                <div>
                  <label
                    htmlFor="setting-vat-rate"
                    className="block text-[11px] font-bold uppercase text-slate-600 mb-1"
                  >
                    UK VAT Rate (%)
                  </label>
                  <input
                    id="setting-vat-rate"
                    name="vatPercentage"
                    type="number"
                    step="0.5"
                    min="0"
                    max="50"
                    value={settingsForm.vatPercentage}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        vatPercentage: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold"
                  />
                </div>

                <div>
                  <label
                    htmlFor="setting-eho-days"
                    className="block text-[11px] font-bold uppercase text-slate-600 mb-1"
                  >
                    EHO Cycle (Days)
                  </label>
                  <input
                    id="setting-eho-days"
                    name="ehoReviewDays"
                    type="number"
                    min="7"
                    max="365"
                    value={settingsForm.ehoReviewDays}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        ehoReviewDays: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="setting-kiosk-notice"
                  className="block text-xs font-bold uppercase text-slate-600 mb-1"
                >
                  Customer Kiosk Safety Banner Notice
                </label>
                <textarea
                  id="setting-kiosk-notice"
                  name="kioskSafetyNotice"
                  rows={2}
                  value={settingsForm.kioskSafetyNotice}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      kioskSafetyNotice: e.target.value,
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              {/* Menu Category Manager */}
              <div className="pt-3 border-t border-slate-200 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-600">
                  <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                  Menu Categories
                </div>

                <div className="flex gap-2">
                  <input
                    id="new-category-input"
                    name="newCategoryInput"
                    type="text"
                    placeholder="Add category (e.g. Milkshakes & Smoothies)..."
                    value={newCategoryInput}
                    onChange={(e) => setNewCategoryInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCategory();
                      }
                    }}
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddCategory}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {settingsForm.categories.map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 text-xs font-semibold"
                    >
                      <span>{cat}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCategory(cat)}
                        className="text-slate-400 hover:text-red-600"
                        title="Remove category"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSavingSettings}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm transition flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              {isSavingSettings
                ? 'Saving Venue Settings...'
                : 'Save Venue & Financial Settings'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
