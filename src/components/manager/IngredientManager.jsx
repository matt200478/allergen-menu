// src/components/manager/IngredientManager.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  writeBatch,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { UK_ALLERGENS, GLUTEN_CEREALS } from './DishBuilder';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  PackageCheck,
  PackageX,
  Database,
  X,
  Save,
} from 'lucide-react';

// Helper to create a clean default allergen map
const createDefaultAllergens = () => {
  const map = {};
  UK_ALLERGENS.forEach((a) => {
    map[a.key] = 'No';
  });
  GLUTEN_CEREALS.forEach((c) => {
    map[c.key] = 'No';
  });
  return map;
};

const INITIAL_FORM_STATE = {
  supplier: '',
  supplierCode: '',
  productName: '',
  caloriesPer100g: '',
  costPerPack: '',
  packWeightGrams: '',
  ingredientList: '',
  inStock: true,
  allergens: createDefaultAllergens(),
};

export default function IngredientManager() {
  const [ingredients, setIngredients] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStock, setFilterStock] = useState('ALL'); // 'ALL' | 'IN_STOCK' | 'OOS'

  // Modal / Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // 1. Subscribe to both Ingredients and Dishes (to map OOS dependencies)
  useEffect(() => {
    const unsubIngredients = onSnapshot(collection(db, 'ingredients'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.productName.localeCompare(b.productName));
      setIngredients(list);
      setLoading(false);
    });

    const unsubDishes = onSnapshot(collection(db, 'dishes'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setDishes(list);
    });

    return () => {
      unsubIngredients();
      unsubDishes();
    };
  }, []);

  // 2. Map Ingredient ID -> Array of Dishes that rely on it (Feature 3: OOS Dependency Mapping)
  const dependencyMap = useMemo(() => {
    const map = {};
    dishes.forEach((dish) => {
      (dish.components || []).forEach((comp) => {
        if (!map[comp.ingredientId]) {
          map[comp.ingredientId] = [];
        }
        if (!map[comp.ingredientId].some((d) => d.id === dish.id)) {
          map[comp.ingredientId].push(dish);
        }
      });
    });
    return map;
  }, [dishes]);

  // Cycle allergen status: "No" -> "May Contain" -> "Yes" -> "No"
  const handleCycleAllergen = (key) => {
    const order = ['No', 'May Contain', 'Yes'];
    setFormData((prev) => {
      const current = prev.allergens[key] || 'No';
      const next = order[(order.indexOf(current) + 1) % order.length];
      const updatedAllergens = { ...prev.allergens, [key]: next };

      // Automatically escalate parent 'gluten' if any specific cereal is Yes or May Contain
      if (GLUTEN_CEREALS.some((c) => c.key === key)) {
        const cerealStates = GLUTEN_CEREALS.map((c) => updatedAllergens[c.key]);
        if (cerealStates.includes('Yes')) {
          updatedAllergens.gluten = 'Yes';
        } else if (cerealStates.includes('May Contain')) {
          updatedAllergens.gluten = 'May Contain';
        }
      }

      return { ...prev, allergens: updatedAllergens };
    });
  };

  // Open modal for New or Edit
  const openModal = (ingredient = null) => {
    if (ingredient) {
      setEditingId(ingredient.id);
      setFormData({
        supplier: ingredient.supplier || '',
        supplierCode: ingredient.supplierCode || '',
        productName: ingredient.productName || '',
        caloriesPer100g: ingredient.caloriesPer100g ?? '',
        costPerPack: ingredient.costPerPack ?? '',
        packWeightGrams: ingredient.packWeightGrams ?? '',
        ingredientList: ingredient.ingredientList || '',
        inStock: ingredient.inStock ?? true,
        allergens: { ...createDefaultAllergens(), ...(ingredient.allergens || {}) },
      });
    } else {
      setEditingId(null);
      setFormData(INITIAL_FORM_STATE);
    }
    setIsModalOpen(true);
  };

  // 3. Instant Out-of-Stock (OOS) Toggle + Automatic Dish Cascade Update
  const handleToggleStock = async (ingredient) => {
    const newStockState = !ingredient.inStock;
    const affectedDishes = dependencyMap[ingredient.id] || [];

    try {
      const batch = writeBatch(db);
      const ingRef = doc(db, 'ingredients', ingredient.id);

      batch.update(ingRef, {
        inStock: newStockState,
        lastVerifiedDate: serverTimestamp(),
      });

      // Update every dependent dish's hasOutOfStockIngredient flag
      affectedDishes.forEach((dish) => {
        const dishHasOos = (dish.components || []).some((comp) => {
          if (comp.ingredientId === ingredient.id) return !newStockState;
          const otherIng = ingredients.find((i) => i.id === comp.ingredientId);
          return otherIng ? otherIng.inStock === false : false;
        });

        batch.update(doc(db, 'dishes', dish.id), {
          hasOutOfStockIngredient: dishHasOos,
          updatedAt: serverTimestamp(),
        });
      });

      // Log audit action
      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: `Marked ingredient "${ingredient.productName}" as ${
          newStockState ? 'IN STOCK' : 'OUT OF STOCK'
        } (${affectedDishes.length} menu dishes affected)`,
        userId: auth.currentUser?.uid || 'manager-session',
      });

      await batch.commit();

      setFeedback({
        type: newStockState ? 'success' : 'warning',
        text: `"${ingredient.productName}" marked ${
          newStockState ? 'In Stock' : 'Out of Stock'
        }. ${affectedDishes.length} dependent dish(es) updated automatically.`,
      });
    } catch (error) {
      console.error('Error toggling stock:', error);
      setFeedback({ type: 'error', text: `Stock update failed: ${error.message}` });
    }
  };

  // 4. Save New or Edited Ingredient + Audit Log
  const handleSaveIngredient = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const batch = writeBatch(db);
      const ingRef = editingId
        ? doc(db, 'ingredients', editingId)
        : doc(collection(db, 'ingredients'));

      const payload = {
        supplier: formData.supplier.trim(),
        supplierCode: formData.supplierCode.trim(),
        productName: formData.productName.trim(),
        caloriesPer100g: Number(formData.caloriesPer100g),
        costPerPack: Number(formData.costPerPack),
        packWeightGrams: Number(formData.packWeightGrams),
        ingredientList: formData.ingredientList.trim(),
        inStock: Boolean(formData.inStock),
        allergens: formData.allergens,
        lastVerifiedDate: serverTimestamp(),
      };

      batch.set(ingRef, payload, { merge: true });

      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: editingId
          ? `Updated ingredient allergen & spec profile: "${payload.productName}"`
          : `Created new ingredient: "${payload.productName}" (${payload.supplierCode})`,
        userId: auth.currentUser?.uid || 'manager-session',
      });

      await batch.commit();
      setIsModalOpen(false);
      setFeedback({
        type: 'success',
        text: `Ingredient "${payload.productName}" saved and audit log recorded.`,
      });
    } catch (error) {
      console.error('Failed to save ingredient:', error);
      setFeedback({ type: 'error', text: `Save failed: ${error.message}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteIngredient = async (ingredient) => {
    const usedIn = dependencyMap[ingredient.id] || [];
    if (usedIn.length > 0) {
      setFeedback({
        type: 'error',
        text: `Cannot delete "${ingredient.productName}" because it is used in: ${usedIn
          .map((d) => d.name)
          .join(', ')}.`,
      });
      return;
    }

    if (!window.confirm(`Delete "${ingredient.productName}" permanently?`)) return;

    try {
      await deleteDoc(doc(db, 'ingredients', ingredient.id));
      setFeedback({ type: 'success', text: `"${ingredient.productName}" deleted.` });
    } catch (error) {
      setFeedback({ type: 'error', text: error.message });
    }
  };

  // 5. Quick-Seed Sample Ingredients for testing a brand-new Firestore database
  const handleSeedDemoIngredients = async () => {
    const sampleItems = [
      {
        supplier: 'Brakes',
        supplierCode: 'BRK-10492',
        productName: 'Glazed Brioche Burger Bun (85g)',
        caloriesPer100g: 294,
        costPerPack: 14.4,
        packWeightGrams: 4080, // 48 x 85g
        ingredientList:
          'WHEAT Flour (with Calcium, Iron, Niacin, Thiamin), Water, Sugar, Rapeseed Oil, Glaze (Water, MILK Proteins, Egg), Yeast, Salt, Malted BARLEY Flour',
        inStock: true,
        allergens: {
          ...createDefaultAllergens(),
          gluten: 'Yes',
          wheat: 'Yes',
          barley: 'Yes',
          eggs: 'Yes',
          milk: 'Yes',
          sesame: 'May Contain',
        },
      },
      {
        supplier: 'Bidfood',
        supplierCode: 'BID-88310',
        productName: 'Prime 4oz Beef Burger Patty (113g)',
        caloriesPer100g: 252,
        costPerPack: 28.5,
        packWeightGrams: 5424, // 48 x 113g
        ingredientList: 'Beef (98%), Sea Salt, Cracked Black Pepper',
        inStock: true,
        allergens: createDefaultAllergens(),
      },
      {
        supplier: 'Brakes',
        supplierCode: 'BRK-33201',
        productName: 'Monterey Jack Cheese Slices (20g)',
        caloriesPer100g: 373,
        costPerPack: 9.8,
        packWeightGrams: 1000,
        ingredientList: 'Pasteurised Cow MILK, Salt, Vegetarian Rennet, Starter Culture',
        inStock: true,
        allergens: {
          ...createDefaultAllergens(),
          milk: 'Yes',
        },
      },
      {
        supplier: 'Bidfood',
        supplierCode: 'BID-55190',
        productName: 'Crispy Coated Skin-On Fries',
        caloriesPer100g: 165,
        costPerPack: 16.2,
        packWeightGrams: 10000, // 10kg box
        ingredientList:
          'Potato (89%), Sunflower Oil, Batter (Rice Flour, Potato Dextrin, Salt, Turmeric)',
        inStock: true,
        allergens: {
          ...createDefaultAllergens(),
          gluten: 'May Contain',
          wheat: 'May Contain',
        },
      },
    ];

    try {
      const batch = writeBatch(db);
      sampleItems.forEach((item) => {
        const ref = doc(collection(db, 'ingredients'));
        batch.set(ref, { ...item, lastVerifiedDate: serverTimestamp() });
      });
      await batch.commit();
      setFeedback({
        type: 'success',
        text: '4 sample FEC ingredients added to Firestore! You can now build dishes.',
      });
    } catch (error) {
      setFeedback({ type: 'error', text: `Failed to seed data: ${error.message}` });
    }
  };

  // Filtered Ingredients list
  const filteredIngredients = useMemo(() => {
    return ingredients.filter((ing) => {
      const matchesSearch =
        ing.productName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ing.supplierCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ing.supplier?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStock =
        filterStock === 'ALL' ||
        (filterStock === 'IN_STOCK' && ing.inStock !== false) ||
        (filterStock === 'OOS' && ing.inStock === false);
      return matchesSearch && matchesStock;
    });
  }, [ingredients, searchQuery, filterStock]);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">
            Ingredient & Stock Inventory
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Manage supplier packs, 14-allergen profiles, and live Out-of-Stock (OOS) dish dependencies.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {ingredients.length === 0 && !loading && (
            <button
              type="button"
              onClick={handleSeedDemoIngredients}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm shadow-sm transition"
            >
              <Database className="w-4 h-4" />
              Seed 4 Sample Ingredients
            </button>
          )}
          <button
            type="button"
            onClick={() => openModal()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Add New Ingredient
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`mt-4 p-4 rounded-xl border flex items-center justify-between ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-300 text-red-900'
              : feedback.type === 'warning'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2.5 text-sm font-medium">
            {feedback.type === 'error' || feedback.type === 'warning' ? (
              <AlertTriangle className="w-5 h-5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-xs font-bold underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Stock Filter Bar */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search by ingredient, supplier, or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-600"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {['ALL', 'IN_STOCK', 'OOS'].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilterStock(status)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                filterStock === status
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {status === 'ALL'
                ? `All (${ingredients.length})`
                : status === 'IN_STOCK'
                ? 'In Stock Only'
                : 'Out of Stock (OOS)'}
            </button>
          ))}
        </div>
      </div>

      {/* Ingredients Table */}
      <div className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-600">
                <th className="py-3.5 px-4">Stock Status</th>
                <th className="py-3.5 px-4">Ingredient & Supplier</th>
                <th className="py-3.5 px-4">Pack Cost / Weight</th>
                <th className="py-3.5 px-4">Active Allergens</th>
                <th className="py-3.5 px-4">Menu Dependencies (OOS Impact)</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredIngredients.map((ing) => {
                const dependentDishes = dependencyMap[ing.id] || [];
                const activeAllergens = UK_ALLERGENS.filter(
                  (a) => ing.allergens?.[a.key] === 'Yes' || ing.allergens?.[a.key] === 'May Contain'
                );

                return (
                  <tr
                    key={ing.id}
                    className={ing.inStock === false ? 'bg-red-50/60' : 'hover:bg-slate-50'}
                  >
                    {/* Instant Stock Toggle */}
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        onClick={() => handleToggleStock(ing)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                          ing.inStock === false
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        }`}
                      >
                        {ing.inStock === false ? (
                          <>
                            <PackageX className="w-4 h-4" />
                            OUT OF STOCK
                          </>
                        ) : (
                          <>
                            <PackageCheck className="w-4 h-4" />
                            In Stock
                          </>
                        )}
                      </button>
                    </td>

                    {/* Name & Supplier */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{ing.productName}</div>
                      <div className="text-xs text-slate-500">
                        {ing.supplier} • Code: <span className="font-mono">{ing.supplierCode}</span> •{' '}
                        {ing.caloriesPer100g} kcal/100g
                      </div>
                    </td>

                    {/* Cost & Pack Size */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-800">
                        £{Number(ing.costPerPack).toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-500">{ing.packWeightGrams}g pack</div>
                    </td>

                    {/* Allergen Badges */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {activeAllergens.length === 0 ? (
                          <span className="text-xs text-slate-400">None</span>
                        ) : (
                          activeAllergens.map((a) => {
                            const isYes = ing.allergens[a.key] === 'Yes';
                            return (
                              <span
                                key={a.key}
                                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                  isYes
                                    ? 'bg-red-100 text-red-800 border border-red-300'
                                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                                }`}
                              >
                                {a.label} ({isYes ? 'Yes' : 'May'})
                              </span>
                            );
                          })
                        )}
                      </div>
                    </td>

                    {/* Dependent Dishes */}
                    <td className="py-3.5 px-4">
                      {dependentDishes.length === 0 ? (
                        <span className="text-xs text-slate-400">Unused</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {dependentDishes.map((d) => (
                            <span
                              key={d.id}
                              className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                ing.inStock === false
                                  ? 'bg-red-600 text-white font-bold'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {d.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openModal(ing)}
                          className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg hover:bg-slate-100"
                          title="Edit Ingredient"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteIngredient(ing)}
                          className="p-2 text-slate-500 hover:text-red-600 rounded-lg hover:bg-red-50"
                          title="Delete Ingredient"
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
        </div>
      </div>

      {/* Add / Edit Ingredient Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-xl border border-slate-200 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h2 className="text-xl font-extrabold text-slate-900">
                {editingId ? 'Edit Ingredient Specification' : 'Add New Ingredient'}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveIngredient} className="mt-4 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.productName}
                    onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Supplier *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Brakes / Bidfood"
                    value={formData.supplier}
                    onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Supplier Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.supplierCode}
                    onChange={(e) => setFormData({ ...formData, supplierCode: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Cost Per Pack (£) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.costPerPack}
                    onChange={(e) => setFormData({ ...formData, costPerPack: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Pack Weight (Grams) *
                  </label>
                  <input
                    type="number"
                    step="1"
                    required
                    value={formData.packWeightGrams}
                    onChange={(e) => setFormData({ ...formData, packWeightGrams: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Calories per 100g (kcal) *
                  </label>
                  <input
                    type="number"
                    step="1"
                    required
                    value={formData.caloriesPer100g}
                    onChange={(e) => setFormData({ ...formData, caloriesPer100g: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              {/* Supplier Ingredient Sub-list for Natasha's Law */}
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Supplier Sub-Ingredients List (Copied from Spec Sheet for Natasha&apos;s Law) *
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. Wheat Flour, Water, Sugar, Milk Proteins, Egg, Malted Barley Flour"
                  value={formData.ingredientList}
                  onChange={(e) => setFormData({ ...formData, ingredientList: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              {/* 14 Major Allergens Interactive Tap Grid */}
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-2">
                  14 Major Allergens (Tap to cycle: No → May Contain → Yes)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {UK_ALLERGENS.map((allergen) => {
                    const status = formData.allergens[allergen.key] || 'No';
                    return (
                      <button
                        key={allergen.key}
                        type="button"
                        onClick={() => handleCycleAllergen(allergen.key)}
                        className={`p-2.5 rounded-xl border text-left text-xs flex items-center justify-between transition ${
                          status === 'Yes'
                            ? 'bg-red-600 text-white border-red-700 font-bold'
                            : status === 'May Contain'
                            ? 'bg-amber-400 text-slate-950 border-amber-500 font-bold'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <span className="truncate">{allergen.label}</span>
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-black/10">
                          {status}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Specific Cereal Sub-Tracing */}
              <div className="pt-2 border-t border-slate-200">
                <label className="block text-xs font-bold uppercase text-slate-600 mb-2">
                  Specific Cereal Tracing (Wheat, Barley, Rye, Oats)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {GLUTEN_CEREALS.map((cereal) => {
                    const status = formData.allergens[cereal.key] || 'No';
                    return (
                      <button
                        key={cereal.key}
                        type="button"
                        onClick={() => handleCycleAllergen(cereal.key)}
                        className={`p-2 rounded-xl border text-center text-xs transition ${
                          status === 'Yes'
                            ? 'bg-red-600 text-white border-red-700 font-bold'
                            : status === 'May Contain'
                            ? 'bg-amber-400 text-slate-950 border-amber-500 font-bold'
                            : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        <div>{cereal.label}</div>
                        <div className="text-[10px] uppercase opacity-80">{status}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm"
                >
                  <Save className="w-4 h-4" />
                  {isSubmitting ? 'Saving...' : 'Save Ingredient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
