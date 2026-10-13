// src/components/kiosk/CustomerKiosk.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import {
  UK_ALLERGENS,
  GLUTEN_CEREALS,
  formatPPDSString,
} from '../manager/DishBuilder';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Flame,
  Search,
  Filter,
  RotateCcw,
  Info,
  X,
  CheckCircle2,
  Ban,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';

export default function CustomerKiosk() {
  const [dishes, setDishes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Customer Filter State
  const [excludedAllergens, setExcludedAllergens] = useState([]); // Array of allergen keys to avoid
  const [strictMode, setStrictMode] = useState(true); // True = also exclude "May Contain"
  const [showExcludedDishes, setShowExcludedDishes] = useState(false); // False = hide unsafe dishes; True = dim them with reason
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(true);

  // Modal State for Full Natasha's Law (PPDS) Ingredient Breakdown
  const [selectedDish, setSelectedDish] = useState(null);

  // 1. Real-Time Subscription to Active Menu Dishes Only
  useEffect(() => {
    const q = query(collection(db, 'dishes'), where('isActive', '==', true));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const liveDishes = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        liveDishes.sort((a, b) => a.name.localeCompare(b.name));
        setDishes(liveDishes);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading kiosk menu:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Dynamically derive unique categories from active dishes
  const categories = useMemo(() => {
    const unique = new Set(dishes.map((d) => d.category).filter(Boolean));
    return ['ALL', ...Array.from(unique)];
  }, [dishes]);

  // Toggle an allergen in the customer's exclusion list
  const toggleAllergenExclusion = (key) => {
    setExcludedAllergens((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const clearAllFilters = () => {
    setExcludedAllergens([]);
    setSelectedCategory('ALL');
    setSearchQuery('');
  };

  // Lookup label for any allergen or cereal key
  const getAllergenLabel = (key) => {
    const foundMain = UK_ALLERGENS.find((a) => a.key === key);
    if (foundMain) return foundMain.label;
    const foundCereal = GLUTEN_CEREALS.find((c) => c.key === key);
    return foundCereal ? `Gluten (${foundCereal.label})` : key;
  };

  // 2. Evaluate each dish against the customer's selected allergens & Strict Mode
  const evaluatedDishes = useMemo(() => {
    return dishes
      .filter((dish) => {
        const matchesCategory =
          selectedCategory === 'ALL' || dish.category === selectedCategory;
        const matchesSearch =
          !searchQuery.trim() ||
          dish.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          dish.category?.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
      })
      .map((dish) => {
        const dishAllergens = dish.allergens || {};
        const directConflicts = []; // Marked "Yes"
        const traceConflicts = []; // Marked "May Contain"

        excludedAllergens.forEach((allergenKey) => {
          const status = dishAllergens[allergenKey] || 'No';
          if (status === 'Yes') {
            directConflicts.push(getAllergenLabel(allergenKey));
          } else if (status === 'May Contain') {
            traceConflicts.push(getAllergenLabel(allergenKey));
          }
        });

        // Determine if dish is excluded based on Strict Mode toggle
        const isExcluded =
          directConflicts.length > 0 ||
          (strictMode && traceConflicts.length > 0);

        return {
          ...dish,
          directConflicts,
          traceConflicts,
          isExcluded,
        };
      });
  }, [dishes, selectedCategory, searchQuery, excludedAllergens, strictMode]);

  const visibleDishes = useMemo(() => {
    if (showExcludedDishes) return evaluatedDishes;
    return evaluatedDishes.filter((d) => !d.isExcluded);
  }, [evaluatedDishes, showExcludedDishes]);

  const hiddenCount = evaluatedDishes.length - visibleDishes.length;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-20">
      {/* Top Kiosk Header */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-lg shadow-inner">
              F&B
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight">
                Interactive Menu &amp; Allergen Guide
              </h1>
              <p className="text-xs text-slate-300">
                Tap any allergens below to filter dishes safely in real time
              </p>
            </div>
          </div>

          {/* Search & Filter Drawer Toggle */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-60">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search menu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="button"
              onClick={() => setIsFilterDrawerOpen((prev) => !prev)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition ${
                excludedAllergens.length > 0
                  ? 'bg-amber-400 text-slate-950 border-amber-300'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Filter className="w-4 h-4" />
              Allergens
              {excludedAllergens.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-slate-950 text-white font-extrabold">
                  {excludedAllergens.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* FSA Safety Notice */}
        <div className="bg-indigo-950/90 border-t border-indigo-800/60 px-4 py-2 text-center text-xs text-indigo-200">
          <strong className="font-bold text-white">Allergy Safety Notice:</strong> Our kitchen handles multiple allergens. Always inform a team member of any food allergies before ordering.
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-5 space-y-6">
        {/* Interactive Allergen Filter Panel */}
        {isFilterDrawerOpen && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-600" />
                  Select Allergens to Avoid
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tap the allergens you want to exclude from your menu view.
                </p>
              </div>

              {/* Strict Mode ("May Contain") Toggle & Reset */}
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition select-none ${
                    strictMode
                      ? 'bg-red-50 border-red-300 text-red-900'
                      : 'bg-amber-50 border-amber-300 text-amber-950'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={strictMode}
                    onChange={(e) => setStrictMode(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 rounded-full peer peer-checked:bg-red-600 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                  <div>
                    <div>Strict Mode: Exclude &ldquo;May Contain&rdquo;</div>
                    <div className="text-[10px] font-normal opacity-80">
                      {strictMode
                        ? 'Hiding both "Yes" and "May Contain" traces'
                        : 'Showing "May Contain" items with an amber warning'}
                    </div>
                  </div>
                </label>

                {excludedAllergens.length > 0 && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset ({excludedAllergens.length})
                  </button>
                )}
              </div>
            </div>

            {/* 14 Major Allergen Tap Pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {UK_ALLERGENS.map((allergen) => {
                const isSelected = excludedAllergens.includes(allergen.key);
                return (
                  <button
                    key={allergen.key}
                    type="button"
                    onClick={() => toggleAllergenExclusion(allergen.key)}
                    aria-pressed={isSelected}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between min-h-[60px] ${
                      isSelected
                        ? 'bg-red-600 text-white border-red-700 shadow-sm font-bold ring-2 ring-red-300'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 font-semibold'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs leading-tight">{allergen.label}</span>
                      {isSelected && <Ban className="w-3.5 h-3.5 shrink-0" />}
                    </div>
                    <span
                      className={`text-[10px] mt-1 uppercase tracking-wider ${
                        isSelected ? 'text-red-100' : 'text-slate-400'
                      }`}
                    >
                      {isSelected ? 'Avoiding' : 'Tap to avoid'}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Specific Gluten Cereal Sub-Filters */}
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase text-slate-500">
                Specific Cereal Tracing (Filter individual gluten grains):
              </span>
              <div className="flex flex-wrap gap-2">
                {GLUTEN_CEREALS.map((cereal) => {
                  const isSelected = excludedAllergens.includes(cereal.key);
                  return (
                    <button
                      key={cereal.key}
                      type="button"
                      onClick={() => toggleAllergenExclusion(cereal.key)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-red-600 text-white border-red-700'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {isSelected && <Ban className="w-3 h-3" />}
                      {cereal.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Filter Status Bar */}
            {excludedAllergens.length > 0 && (
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="text-slate-700">
                  Filtering out{' '}
                  <strong className="font-bold text-red-600">
                    {excludedAllergens.map(getAllergenLabel).join(', ')}
                  </strong>{' '}
                  ({hiddenCount} {hiddenCount === 1 ? 'dish' : 'dishes'} hidden)
                </div>
                <button
                  type="button"
                  onClick={() => setShowExcludedDishes((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 font-bold text-indigo-600 hover:text-indigo-800"
                >
                  {showExcludedDishes ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      Hide unsuitable dishes
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      Show unsuitable dishes (dimmed)
                    </>
                  )}
                </button>
              </div>
            )}
          </section>
        )}

        {/* Category Navigation Pills */}
        <nav className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2.5 rounded-full text-xs font-extrabold whitespace-nowrap transition shadow-2xs ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat === 'ALL' ? 'All Menu Items' : cat}
            </button>
          ))}
        </nav>

        {/* Dish Grid */}
        {loading ? (
          <div className="py-16 text-center text-slate-500 font-medium">
            Loading live menu and allergen profiles...
          </div>
        ) : visibleDishes.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-slate-200 space-y-3">
            <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
            <h3 className="text-lg font-extrabold text-slate-800">
              No matching dishes found
            </h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              No active dishes match your current allergen or category filters. Try disabling Strict Mode or clearing one of your filters.
            </p>
            <button
              type="button"
              onClick={clearAllFilters}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold"
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleDishes.map((dish) => {
              const isOutOfStock = dish.hasOutOfStockIngredient === true;
              const presentAllergens = UK_ALLERGENS.filter(
                (a) => dish.allergens?.[a.key] === 'Yes'
              );
              const mayContainAllergens = UK_ALLERGENS.filter(
                (a) => dish.allergens?.[a.key] === 'May Contain'
              );

              return (
                <article
                  key={dish.id}
                  onClick={() => setSelectedDish(dish)}
                  className={`bg-white rounded-2xl border overflow-hidden shadow-xs hover:shadow-md transition cursor-pointer flex flex-col justify-between relative ${
                    dish.isExcluded
                      ? 'opacity-50 grayscale-[40%] border-red-300'
                      : isOutOfStock
                      ? 'opacity-75 border-slate-300'
                      : 'border-slate-200'
                  }`}
                >
                  <div>
                    {/* Optional Photo Header or Clean Category Header */}
                    {dish.photoUrl ? (
                      <div className="h-44 w-full bg-slate-200 relative overflow-hidden">
                        <img
                          src={dish.photoUrl}
                          alt={dish.name}
                          className="w-full h-full object-cover"
                        />
                        {isOutOfStock && (
                          <div className="absolute inset-0 bg-slate-900/75 flex items-center justify-center">
                            <span className="px-4 py-1.5 rounded-full bg-red-600 text-white text-xs font-black uppercase tracking-wider shadow-lg">
                              Sold Out / Unavailable
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      isOutOfStock && (
                        <div className="bg-red-600 text-white text-center py-1.5 text-xs font-black uppercase tracking-wider">
                          Temporarily Unavailable (Out of Stock)
                        </div>
                      )
                    )}

                    <div className="p-4 space-y-3">
                      {/* Category & Suitability Status */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                          {dish.category}
                        </span>

                        {excludedAllergens.length > 0 && !dish.isExcluded && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                            <CheckCircle2 className="w-3 h-3" />
                            Matches Filter
                          </span>
                        )}
                      </div>

                      {/* Dish Title & Price */}
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                          {dish.name}
                        </h3>
                        <span className="text-base font-black text-slate-900 shrink-0">
                          £{Number(dish.retailPrice).toFixed(2)}
                        </span>
                      </div>

                      {/* Calories Pill */}
                      <div className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-50 px-2.5 py-1 rounded-lg border border-orange-200/70">
                        <Flame className="w-3.5 h-3.5" />
                        {dish.totalCalories || 0} kcal
                      </div>

                      {/* Conflict Warnings (when Strict Mode is OFF or Show Excluded is ON) */}
                      {dish.directConflicts.length > 0 && (
                        <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 font-bold flex items-start gap-2">
                          <Ban className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                          <span>
                            Contains excluded allergen:{' '}
                            {dish.directConflicts.join(', ')}
                          </span>
                        </div>
                      )}

                      {dish.traceConflicts.length > 0 && (
                        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 font-bold flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <span>
                            May contain traces of:{' '}
                            {dish.traceConflicts.join(', ')}
                          </span>
                        </div>
                      )}

                      {/* Full Dish Allergen Summary Pills */}
                      <div className="pt-2 border-t border-slate-100 space-y-1.5">
                        {presentAllergens.length === 0 &&
                        mayContainAllergens.length === 0 ? (
                          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                            <Sparkles className="w-3.5 h-3.5" />
                            No 14 major allergens declared in recipe
                          </div>
                        ) : (
                          <>
                            {presentAllergens.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-[10px] font-bold uppercase text-slate-500 mr-1">
                                  Contains:
                                </span>
                                {presentAllergens.map((a) => (
                                  <span
                                    key={a.key}
                                    className="px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 text-[11px] font-bold"
                                  >
                                    {a.label}
                                  </span>
                                ))}
                              </div>
                            )}

                            {mayContainAllergens.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-[10px] font-bold uppercase text-slate-500 mr-1">
                                  May Contain:
                                </span>
                                {mayContainAllergens.map((a) => (
                                  <span
                                    key={a.key}
                                    className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200 text-[11px] font-semibold"
                                  >
                                    {a.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-indigo-600">
                    <span>View full ingredients (Natasha&apos;s Law)</span>
                    <Info className="w-4 h-4" />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Dish Detail & Natasha's Law (PPDS) Modal */}
      {selectedDish && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setSelectedDish(null)}
        >
          <div
            className="bg-white w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <span className="text-xs font-bold uppercase text-indigo-600">
                  {selectedDish.category}
                </span>
                <h2 className="text-xl font-extrabold text-slate-900 mt-0.5">
                  {selectedDish.name}
                </h2>
                <div className="flex items-center gap-3 mt-1 text-sm font-bold text-slate-700">
                  <span>£{Number(selectedDish.retailPrice).toFixed(2)}</span>
                  <span>•</span>
                  <span className="text-orange-700">
                    {selectedDish.totalCalories || 0} kcal
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedDish(null)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Out of Stock Alert inside Modal */}
            {selectedDish.hasOutOfStockIngredient && (
              <div className="p-3.5 rounded-xl bg-red-600 text-white text-xs font-bold flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>
                  This dish is currently unavailable due to an out-of-stock ingredient.
                </span>
              </div>
            )}

            {/* 14 Major Allergens Grid */}
            <div>
              <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">
                Allergen Profile (14 Major Allergens)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {UK_ALLERGENS.map((a) => {
                  const status = selectedDish.allergens?.[a.key] || 'No';
                  return (
                    <div
                      key={a.key}
                      className={`p-2 rounded-xl border text-xs flex items-center justify-between ${
                        status === 'Yes'
                          ? 'bg-red-600 text-white border-red-700 font-bold'
                          : status === 'May Contain'
                          ? 'bg-amber-400 text-slate-950 border-amber-500 font-bold'
                          : 'bg-slate-50 text-slate-400 border-slate-200'
                      }`}
                    >
                      <span className="truncate pr-1">{a.label}</span>
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-black/10">
                        {status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Specific Gluten Cereal Breakdown */}
            <div>
              <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">
                Specific Gluten Cereal Tracing
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {GLUTEN_CEREALS.map((c) => {
                  const status = selectedDish.allergens?.[c.key] || 'No';
                  return (
                    <div
                      key={c.key}
                      className={`p-2 rounded-xl border text-center text-xs ${
                        status === 'Yes'
                          ? 'bg-red-600 text-white border-red-700 font-bold'
                          : status === 'May Contain'
                          ? 'bg-amber-400 text-slate-950 border-amber-500 font-bold'
                          : 'bg-slate-50 text-slate-400 border-slate-200'
                      }`}
                    >
                      <div className="font-bold">{c.label}</div>
                      <div className="text-[10px] uppercase">{status}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Natasha's Law (PPDS) Full Ingredient Declaration */}
            <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1.5">
              <div className="text-xs font-extrabold uppercase text-slate-800">
                Full Ingredient Declaration (Natasha&apos;s Law / PPDS)
              </div>
              {selectedDish.ppdsIngredientText ? (
                <p
                  className="text-xs leading-relaxed text-slate-800 font-mono"
                  dangerouslySetInnerHTML={{
                    __html: formatPPDSString(selectedDish.ppdsIngredientText).html,
                  }}
                />
              ) : (
                <p className="text-xs text-slate-500 italic">
                  Ingredient breakdown available from a member of our team.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSelectedDish(null)}
              className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold"
            >
              Close Dish Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
