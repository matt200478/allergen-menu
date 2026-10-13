// src/components/manager/DishBuilder.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import {
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Printer,
  Save,
  Calculator,
  ShieldAlert,
  Flame,
  PoundSterling,
  Copy,
  Check,
} from 'lucide-react';

// UK 14 Major Allergens Configuration
export const UK_ALLERGENS = [
  { key: 'celery', label: 'Celery' },
  { key: 'gluten', label: 'Cereals (Gluten)', hasSubTypes: true },
  { key: 'crustaceans', label: 'Crustaceans' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'fish', label: 'Fish' },
  { key: 'lupin', label: 'Lupin' },
  { key: 'milk', label: 'Milk' },
  { key: 'molluscs', label: 'Molluscs' },
  { key: 'mustard', label: 'Mustard' },
  { key: 'nuts', label: 'Tree Nuts' },
  { key: 'peanuts', label: 'Peanuts' },
  { key: 'sesame', label: 'Sesame' },
  { key: 'soya', label: 'Soya' },
  { key: 'sulphites', label: 'Sulphur Dioxide / Sulphites' },
];

export const GLUTEN_CEREALS = [
  { key: 'wheat', label: 'Wheat' },
  { key: 'barley', label: 'Barley' },
  { key: 'rye', label: 'Rye' },
  { key: 'oats', label: 'Oats' },
];

// Comprehensive keyword list for Natasha's Law (PPDS) automatic bolding & capitalisation
const ALLERGEN_KEYWORDS = [
  'wheat', 'barley', 'rye', 'oats', 'oat', 'spelt', 'kamut', 'gluten',
  'milk', 'butter', 'cream', 'cheese', 'whey', 'casein', 'lactose', 'buttermilk', 'yoghurt', 'yogurt',
  'egg', 'eggs', 'albumen', 'ovalbumin',
  'soya', 'soy', 'soybean', 'edamame', 'tofu',
  'peanut', 'peanuts', 'groundnut', 'groundnuts',
  'almond', 'almonds', 'hazelnut', 'hazelnuts', 'walnut', 'walnuts', 'cashew', 'cashews',
  'pecan', 'pecans', 'brazil nut', 'brazil nuts', 'pistachio', 'pistachios', 'macadamia', 'nuts',
  'celery', 'celeriac',
  'mustard',
  'sesame',
  'sulphites', 'sulphite', 'sulfur dioxide', 'sulphur dioxide', 'metabisulphite',
  'lupin', 'lupine',
  'fish', 'cod', 'haddock', 'salmon', 'tuna', 'anchovy', 'anchovies', 'pollock',
  'crustaceans', 'crustacean', 'prawn', 'prawns', 'shrimp', 'crab', 'lobster', 'crayfish',
  'molluscs', 'mollusc', 'mussel', 'mussels', 'oyster', 'oysters', 'squid', 'calamari', 'clam', 'clams', 'scallop', 'scallops'
];

// Build Regex that matches whole allergen words (case-insensitive)
const ALLERGEN_REGEX = new RegExp(
  `\\b(${ALLERGEN_KEYWORDS.sort((a, b) => b.length - a.length).join('|')})\\b`,
  'gi'
);

/**
 * Formats an ingredient list string to comply with Natasha's Law (PPDS).
 * Converts recognised allergens to UPPERCASE and wraps them in <strong> tags.
 */
export const formatPPDSString = (rawText) => {
  if (!rawText) return { html: '', plainText: '' };

  const plainText = rawText.replace(ALLERGEN_REGEX, (match) => match.toUpperCase());
  const html = rawText.replace(
    ALLERGEN_REGEX,
    (match) => `<strong class="font-extrabold underline">${match.toUpperCase()}</strong>`
  );

  return { html, plainText };
};

const CATEGORIES = [
  'Burgers & Hot Dogs',
  'Sharing Platters & Bowling Bites',
  'Pizzas',
  'Kids Soft Play Meals',
  'Sides & Loaded Fries',
  'Desserts & Slushies',
  'Hot & Cold Drinks',
];

export default function DishBuilder({ existingDish = null, onSaveSuccess }) {
  // Firestore Ingredients State
  const [ingredients, setIngredients] = useState([]);
  const [loadingIngredients, setLoadingIngredients] = useState(true);

  // Dish Form State
  const [dishName, setDishName] = useState(existingDish?.name || '');
  const [category, setCategory] = useState(existingDish?.category || CATEGORIES[0]);
  const [photoUrl, setPhotoUrl] = useState(existingDish?.photoUrl || '');
  const [retailPrice, setRetailPrice] = useState(existingDish?.retailPrice || '');
  const [isActive, setIsActive] = useState(existingDish?.isActive ?? true);
  const [components, setComponents] = useState(
    existingDish?.components || [{ ingredientId: '', weightGrams: '' }]
  );

  // UI & Accounting Helpers
  const [includeVatInGp, setIncludeVatInGp] = useState(false); // False = pure Gross Retail Price; True = deduct 20% UK VAT
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [copiedPpds, setCopiedPpds] = useState(false);

  // 1. Real-time Subscription to Ingredients Collection
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'ingredients'),
      (snapshot) => {
        const fetched = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        // Sort alphabetically for quick manager selection
        fetched.sort((a, b) => a.productName.localeCompare(b.productName));
        setIngredients(fetched);
        setLoadingIngredients(false);
      },
      (error) => {
        console.error('Error fetching ingredients:', error);
        setLoadingIngredients(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Quick lookup map for O(1) ingredient retrieval
  const ingredientMap = useMemo(() => {
    const map = {};
    ingredients.forEach((ing) => {
      map[ing.id] = ing;
    });
    return map;
  }, [ingredients]);

  // Component Row Handlers
  const handleAddComponent = () => {
    setComponents((prev) => [...prev, { ingredientId: '', weightGrams: '' }]);
  };

  const handleRemoveComponent = (index) => {
    setComponents((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleComponentChange = (index, field, value) => {
    setComponents((prev) =>
      prev.map((comp, idx) =>
        idx === index
          ? {
              ...comp,
              [field]: field === 'weightGrams' ? (value === '' ? '' : Number(value)) : value,
            }
          : comp
      )
    );
  };

  // 2. CORE ENGINE: Calories, Cost, GP%, OOS Dependencies, Allergens & Natasha's Law
  const metrics = useMemo(() => {
    let totalCalories = 0;
    let totalCost = 0;
    let totalWeightGrams = 0;
    const outOfStockItems = [];

    // Initialise all 14 allergens + 4 gluten sub-cereals to "No"
    const aggregatedAllergens = {};
    UK_ALLERGENS.forEach((a) => {
      aggregatedAllergens[a.key] = 'No';
    });
    GLUTEN_CEREALS.forEach((c) => {
      aggregatedAllergens[c.key] = 'No';
    });

    // Helper: Escalate allergen status ("No" -> "May Contain" -> "Yes")
    const mergeAllergenState = (currentVal, incomingVal) => {
      if (currentVal === 'Yes' || incomingVal === 'Yes') return 'Yes';
      if (currentVal === 'May Contain' || incomingVal === 'May Contain') return 'May Contain';
      return 'No';
    };

    const validComponents = [];

    components.forEach((comp) => {
      const ing = ingredientMap[comp.ingredientId];
      const weight = parseFloat(comp.weightGrams) || 0;

      if (!ing || weight <= 0) return;

      validComponents.push({ ing, weight });
      totalWeightGrams += weight;

      // Calorie Calculation: (caloriesPer100g / 100) * weightGrams
      const componentCalories = ((Number(ing.caloriesPer100g) || 0) / 100) * weight;
      totalCalories += componentCalories;

      // Cost Calculation: (costPerPack / packWeightGrams) * weightGrams
      const packWeight = Number(ing.packWeightGrams) || 1;
      const costPerGram = (Number(ing.costPerPack) || 0) / packWeight;
      totalCost += costPerGram * weight;

      // Out-of-Stock Dependency Tracking
      if (ing.inStock === false && !outOfStockItems.includes(ing.productName)) {
        outOfStockItems.push(ing.productName);
      }

      // Allergen Aggregation across 14 major allergens
      const ingAllergens = ing.allergens || {};
      UK_ALLERGENS.forEach(({ key }) => {
        const val = ingAllergens[key] || 'No';
        aggregatedAllergens[key] = mergeAllergenState(aggregatedAllergens[key], val);
      });

      // Specific Cereal Tracing (Wheat, Barley, Rye, Oats)
      GLUTEN_CEREALS.forEach(({ key }) => {
        const val = ingAllergens[key] || ingAllergens.cereals?.[key] || 'No';
        aggregatedAllergens[key] = mergeAllergenState(aggregatedAllergens[key], val);
        // Automatically ensure parent 'gluten' reflects any positive cereal trace
        if (val === 'Yes' || val === 'May Contain') {
          aggregatedAllergens.gluten = mergeAllergenState(aggregatedAllergens.gluten, val);
        }
      });
    });

    // Gross Profit (GP%) Calculation
    const priceNum = parseFloat(retailPrice) || 0;
    const effectiveRevenue = includeVatInGp ? priceNum / 1.2 : priceNum;
    const grossProfit = effectiveRevenue - totalCost;
    const gpPercentage =
      effectiveRevenue > 0 ? ((effectiveRevenue - totalCost) / effectiveRevenue) * 100 : 0;

    // Natasha's Law (PPDS) Composite String Generation
    // Sort components by weight descending (UK Quantitative Ingredient Declaration order)
    const sortedForPpds = [...validComponents].sort((a, b) => b.weight - a.weight);
    const rawCompositeIngredients = sortedForPpds
      .map(({ ing }) => `${ing.productName} (${ing.ingredientList || ing.productName})`)
      .join(', ');

    const ppdsFormatted = formatPPDSString(rawCompositeIngredients);

    return {
      totalCalories: Math.round(totalCalories),
      totalCost,
      totalWeightGrams: Math.round(totalWeightGrams),
      grossProfit,
      gpPercentage,
      effectiveRevenue,
      aggregatedAllergens,
      outOfStockItems,
      ppdsFormatted,
    };
  }, [components, ingredientMap, retailPrice, includeVatInGp]);

  // Copy PPDS plain text to clipboard for thermal label software
  const handleCopyPpds = () => {
    if (!metrics.ppdsFormatted.plainText) return;
    navigator.clipboard.writeText(
      `INGREDIENTS: ${metrics.ppdsFormatted.plainText}`
    );
    setCopiedPpds(true);
    setTimeout(() => setCopiedPpds(false), 2000);
  };

  // 3. Save Dish & Write Audit Log via Atomic Firestore Batch
  const handleSaveDish = async (e) => {
    e.preventDefault();
    setStatusMessage(null);

    const cleanedComponents = components.filter(
      (c) => c.ingredientId && Number(c.weightGrams) > 0
    );

    if (!dishName.trim() || !retailPrice || cleanedComponents.length === 0) {
      setStatusMessage({
        type: 'error',
        text: 'Please provide a dish name, retail price, and at least one valid ingredient with weight.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const dishRef = existingDish?.id
        ? doc(db, 'dishes', existingDish.id)
        : doc(collection(db, 'dishes'));

      // Note: totalCost and gpPercentage are deliberately excluded from the public
      // dish document to enforce commercial privacy on the Customer Kiosk.
      const dishPayload = {
        name: dishName.trim(),
        category,
        photoUrl: photoUrl.trim() || null,
        retailPrice: parseFloat(retailPrice),
        components: cleanedComponents.map((c) => ({
          ingredientId: c.ingredientId,
          weightGrams: Number(c.weightGrams),
        })),
        // Denormalised safe fields for fast Kiosk rendering & Printable Matrix
        totalCalories: metrics.totalCalories,
        allergens: metrics.aggregatedAllergens,
        ppdsIngredientText: metrics.ppdsFormatted.plainText,
        hasOutOfStockIngredient: metrics.outOfStockItems.length > 0,
        isActive,
        updatedAt: serverTimestamp(),
      };

      batch.set(dishRef, dishPayload, { merge: true });

      // Append immutable entry to audit_logs
      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: existingDish?.id
          ? `Updated dish "${dishName.trim()}" (${cleanedComponents.length} ingredients)`
          : `Created new dish "${dishName.trim()}" (${cleanedComponents.length} ingredients)`,
        dishId: dishRef.id,
        userId: auth.currentUser?.uid || 'manager-session',
      });

      await batch.commit();

      setStatusMessage({
        type: 'success',
        text: `"${dishName.trim()}" saved and audit log recorded.`,
      });

      if (onSaveSuccess) onSaveSuccess(dishRef.id);
    } catch (error) {
      console.error('Error saving dish:', error);
      setStatusMessage({
        type: 'error',
        text: `Failed to save dish: ${error.message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Helper badge styling for Allergen states
  const getAllergenBadgeStyle = (status) => {
    if (status === 'Yes') {
      return 'bg-red-600 text-white border-red-700 shadow-sm font-bold';
    }
    if (status === 'May Contain') {
      return 'bg-amber-500 text-slate-950 border-amber-600 font-semibold';
    }
    return 'bg-slate-100 text-slate-400 border-slate-200';
  };

  // Helper colour coding for GP% margin targets (UK Hospitality benchmark: 70%+ target)
  const getGpColour = (gp) => {
    if (gp >= 70) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (gp >= 60) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 bg-slate-50 min-h-screen text-slate-900">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
            {existingDish ? `Edit Dish: ${existingDish.name}` : 'Dish Builder & Margin Calculator'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Build recipes with live calorie aggregation, GP% margin tracking, and Natasha&apos;s Law (PPDS) compliance.
          </p>
        </div>

        {/* Active Status Toggle */}
        <label className="inline-flex items-center gap-3 cursor-pointer bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all relative peer-checked:bg-emerald-600" />
          <span className="text-sm font-semibold text-slate-700">
            {isActive ? 'Active on Kiosk Menu' : 'Hidden from Kiosk'}
          </span>
        </label>
      </div>

      {/* Out-of-Stock (OOS) Dependency Banner */}
      {metrics.outOfStockItems.length > 0 && (
        <div className="mt-6 p-4 rounded-xl bg-red-50 border-2 border-red-500 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-red-900 uppercase tracking-wide">
              Out-of-Stock Ingredient Dependency Detected
            </h3>
            <p className="text-sm text-red-800 mt-0.5">
              This dish relies on{' '}
              <span className="font-bold underline">
                {metrics.outOfStockItems.join(', ')}
              </span>
              , which is currently marked Out of Stock. This dish will be automatically flagged as unavailable to staff and customers.
            </p>
          </div>
        </div>
      )}

      {/* Status Alert */}
      {statusMessage && (
        <div
          className={`mt-6 p-4 rounded-xl border flex items-center gap-3 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          )}
          <span className="text-sm font-medium">{statusMessage.text}</span>
        </div>
      )}

      <form onSubmit={handleSaveDish} className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Dish Details & Ingredient Builder (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card 1: Dish Metadata */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">1. Dish Details & Pricing</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Dish Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Double Bacon Strike Burger"
                  value={dishName}
                  onChange={(e) => setDishName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Menu Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 text-sm font-medium bg-white"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Retail Selling Price (£) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold">£</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="9.95"
                    value={retailPrice}
                    onChange={(e) => setRetailPrice(e.target.value)}
                    className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 text-sm font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Photo URL (Optional)
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Card 2: Recipe Components Table */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">2. Recipe Components</h2>
                <p className="text-xs text-slate-500">
                  Select ingredients and enter exact portion weights in grams.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddComponent}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                Add Ingredient
              </button>
            </div>

            {loadingIngredients ? (
              <div className="py-8 text-center text-sm text-slate-500">
                Loading ingredients database...
              </div>
            ) : (
              <div className="space-y-3">
                {components.map((comp, index) => {
                  const selectedIng = ingredientMap[comp.ingredientId];
                  const weight = parseFloat(comp.weightGrams) || 0;
                  const rowCalories = selectedIng
                    ? Math.round(((selectedIng.caloriesPer100g || 0) / 100) * weight)
                    : 0;
                  const rowCost = selectedIng
                    ? ((selectedIng.costPerPack || 0) / (selectedIng.packWeightGrams || 1)) *
                      weight
                    : 0;
                  const isOos = selectedIng?.inStock === false;

                  return (
                    <div
                      key={index}
                      className={`p-3.5 rounded-xl border transition ${
                        isOos
                          ? 'bg-red-50/70 border-red-300'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                        {/* Ingredient Selector (6 Cols) */}
                        <div className="sm:col-span-6">
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Ingredient {isOos && <span className="text-red-600">(OUT OF STOCK)</span>}
                          </label>
                          <select
                            required
                            value={comp.ingredientId}
                            onChange={(e) =>
                              handleComponentChange(index, 'ingredientId', e.target.value)
                            }
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium focus:ring-2 focus:ring-indigo-600"
                          >
                            <option value="">-- Select Ingredient --</option>
                            {ingredients.map((ing) => (
                              <option key={ing.id} value={ing.id}>
                                {ing.inStock === false ? '[OOS] ' : ''}
                                {ing.productName} ({ing.supplier} - £
                                {Number(ing.costPerPack).toFixed(2)} / {ing.packWeightGrams}g)
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Weight Input in Grams (3 Cols) */}
                        <div className="sm:col-span-3">
                          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Portion Weight (g)
                          </label>
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            required
                            placeholder="e.g. 120"
                            value={comp.weightGrams}
                            onChange={(e) =>
                              handleComponentChange(index, 'weightGrams', e.target.value)
                            }
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-bold focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>

                        {/* Live Row Metrics & Delete Button (3 Cols) */}
                        <div className="sm:col-span-3 flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-4">
                          <div className="text-right">
                            <div className="text-xs font-bold text-slate-800">
                              £{rowCost.toFixed(2)}
                            </div>
                            <div className="text-[11px] text-slate-500">{rowCalories} kcal</div>
                          </div>

                          <button
                            type="button"
                            disabled={components.length === 1}
                            onClick={() => handleRemoveComponent(index)}
                            className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-30 transition"
                            title="Remove Ingredient"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 3: Natasha's Law (PPDS) Label Generator */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-indigo-600" />
                <div>
                  <h2 className="text-lg font-bold text-slate-800">
                    3. Natasha&apos;s Law (PPDS) Label Preview
                  </h2>
                  <p className="text-xs text-slate-500">
                    Ordered by weight descending with automatic UPPERCASE and bold allergen formatting.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyPpds}
                disabled={!metrics.ppdsFormatted.plainText}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-700 disabled:opacity-40 transition"
              >
                {copiedPpds ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Label Text
                  </>
                )}
              </button>
            </div>

            <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200 font-mono text-xs leading-relaxed text-slate-900">
              <div className="font-bold uppercase text-slate-700 mb-1">
                {dishName || 'Untitled Dish'} ({metrics.totalWeightGrams}g | {metrics.totalCalories} kcal)
              </div>
              {metrics.ppdsFormatted.html ? (
                <p
                  dangerouslySetInnerHTML={{
                    __html: `<strong>INGREDIENTS:</strong> ${metrics.ppdsFormatted.html}.`,
                  }}
                />
              ) : (
                <p className="text-slate-400 italic">
                  Select ingredients above to auto-generate the compliant Natasha&apos;s Law ingredient declaration...
                </p>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Live Metrics, GP% & Allergen Matrix (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card 4: Live Financial & Nutritional Summary */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Calculator className="w-5 h-5 text-indigo-600" />
                Live Margin & Nutrition
              </h2>

              {/* UK VAT Toggle */}
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeVatInGp}
                  onChange={(e) => setIncludeVatInGp(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Deduct 20% VAT
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Total Portion Cost */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
                  <PoundSterling className="w-3.5 h-3.5" />
                  Ingredient Cost
                </div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">
                  £{metrics.totalCost.toFixed(2)}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Cash Profit: £{metrics.grossProfit.toFixed(2)}
                </div>
              </div>

              {/* Gross Profit % */}
              <div
                className={`p-3.5 rounded-xl border ${getGpColour(metrics.gpPercentage)}`}
              >
                <div className="text-xs font-bold uppercase opacity-80">
                  Gross Profit (GP%)
                </div>
                <div className="text-2xl font-extrabold mt-1">
                  {metrics.gpPercentage.toFixed(1)}%
                </div>
                <div className="text-[11px] opacity-80 mt-0.5">
                  {includeVatInGp ? 'Net (ex. 20% VAT)' : 'Gross Retail Basis'}
                </div>
              </div>

              {/* Total Calories */}
              <div className="p-3.5 rounded-xl bg-orange-50 border border-orange-200 text-orange-950 col-span-2 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-orange-700">
                    <Flame className="w-4 h-4" />
                    Total Energy (Kiosk Display)
                  </div>
                  <div className="text-xs text-orange-800 mt-0.5">
                    Total Portion Weight: {metrics.totalWeightGrams}g
                  </div>
                </div>
                <div className="text-2xl font-extrabold text-orange-700">
                  {metrics.totalCalories} kcal
                </div>
              </div>
            </div>
          </div>

          {/* Card 5: Automated 14 Allergen Aggregation */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-indigo-600" />
                Live Allergen Aggregation (14 Major)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatically computed from selected ingredients. Cannot be manually overridden at dish level.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {UK_ALLERGENS.map((allergen) => {
                const status = metrics.aggregatedAllergens[allergen.key];
                return (
                  <div
                    key={allergen.key}
                    className={`px-3 py-2 rounded-xl border text-xs flex items-center justify-between ${getAllergenBadgeStyle(
                      status
                    )}`}
                  >
                    <span className="truncate pr-2">{allergen.label}</span>
                    <span className="uppercase text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-black/10 shrink-0">
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Specific Gluten Cereal Sub-Tracing */}
            <div className="pt-3 border-t border-slate-200">
              <div className="text-xs font-bold uppercase text-slate-500 mb-2">
                Specific Cereal Tracing (Gluten Sub-Types)
              </div>
              <div className="grid grid-cols-4 gap-2">
                {GLUTEN_CEREALS.map((cereal) => {
                  const status = metrics.aggregatedAllergens[cereal.key];
                  return (
                    <div
                      key={cereal.key}
                      className={`p-2 rounded-lg border text-center ${getAllergenBadgeStyle(
                        status
                      )}`}
                    >
                      <div className="text-xs font-bold">{cereal.label}</div>
                      <div className="text-[10px] uppercase opacity-90 mt-0.5">
                        {status}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-3.5 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-extrabold text-base shadow-md hover:shadow-lg transition flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            {isSaving
              ? 'Saving Dish & Recording Audit Log...'
              : existingDish
              ? 'Update Dish & Log Audit Trail'
              : 'Save Dish to Menu'}
          </button>
        </div>
      </form>
    </div>
  );
}
