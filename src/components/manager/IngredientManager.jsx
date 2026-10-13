// src/components/manager/IngredientManager.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Download,
  Upload,
  FileSpreadsheet,
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

// Ordered CSV Column Headers
const CSV_BASE_HEADERS = [
  'supplier',
  'supplierCode',
  'productName',
  'caloriesPer100g',
  'costPerPack',
  'packWeightGrams',
  'inStock',
  'ingredientList',
];

const CSV_ALLERGEN_KEYS = [
  ...UK_ALLERGENS.map((a) => a.key),
  ...GLUTEN_CEREALS.map((c) => c.key),
];

const CSV_HEADERS = [...CSV_BASE_HEADERS, ...CSV_ALLERGEN_KEYS];

/**
 * Escapes a value for RFC-4180 CSV output (handles commas, quotes, and newlines).
 */
const escapeCsvCell = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Parses CSV text into an array of row arrays, respecting quoted commas and newlines.
 */
const parseCsvText = (text) => {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++; // Skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        if (char === '\r') i++;
        currentRow.push(currentCell.trim());
        if (currentRow.some((cell) => cell !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else if (char === '\r') {
        currentRow.push(currentCell.trim());
        if (currentRow.some((cell) => cell !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  // Push final cell/row if file does not end with a newline
  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
};

/**
 * Normalises spreadsheet allergen strings into strict "Yes" | "May Contain" | "No"
 */
const normaliseAllergenValue = (rawVal) => {
  if (!rawVal) return 'No';
  const cleaned = String(rawVal).trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'contains'].includes(cleaned)) return 'Yes';
  if (['may contain', 'may', 'trace', 'traces', 'mc'].includes(cleaned)) {
    return 'May Contain';
  }
  return 'No';
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
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fileInputRef = useRef(null);

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

  // 5. CSV Export (Full Database Backup)
  const handleExportCsv = () => {
    if (ingredients.length === 0) {
      setFeedback({
        type: 'warning',
        text: 'No ingredients available to export yet.',
      });
      return;
    }

    const csvRows = [CSV_HEADERS.join(',')];

    ingredients.forEach((ing) => {
      const row = [
        escapeCsvCell(ing.supplier || ''),
        escapeCsvCell(ing.supplierCode || ''),
        escapeCsvCell(ing.productName || ''),
        escapeCsvCell(ing.caloriesPer100g ?? 0),
        escapeCsvCell(ing.costPerPack ?? 0),
        escapeCsvCell(ing.packWeightGrams ?? 1),
        escapeCsvCell(ing.inStock === false ? 'false' : 'true'),
        escapeCsvCell(ing.ingredientList || ''),
        ...CSV_ALLERGEN_KEYS.map((key) =>
          escapeCsvCell(ing.allergens?.[key] || 'No')
        ),
      ];
      csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.setAttribute('download', `fec-ingredients-export-${dateStamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setFeedback({
      type: 'success',
      text: `Exported ${ingredients.length} ingredient(s) to CSV.`,
    });
  };

  // 6. Download Blank CSV Template with Sample Row
  const handleDownloadCsvTemplate = () => {
    const sampleRow = [
      'Brakes',
      'BRK-10492',
      'Glazed Brioche Burger Bun (85g)',
      '294',
      '14.40',
      '4080',
      'true',
      escapeCsvCell(
        'WHEAT Flour, Water, Sugar, Rapeseed Oil, MILK Proteins, EGG, Malted BARLEY Flour'
      ),
      // 14 major allergens + 4 cereals in exact CSV_ALLERGEN_KEYS order:
      // celery, gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soya, sulphites, wheat, barley, rye, oats
      'No',
      'Yes',
      'No',
      'Yes',
      'No',
      'No',
      'Yes',
      'No',
      'No',
      'No',
      'No',
      'May Contain',
      'No',
      'No',
      'Yes',
      'Yes',
      'No',
      'No',
    ];

    const csvContent = [CSV_HEADERS.join(','), sampleRow.join(',')].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'fec-ingredients-template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 7. CSV Bulk Import (Upsert by supplierCode)
  const handleImportCsvFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImportingCsv(true);
    setFeedback(null);

    try {
      const text = await file.text();
      const parsedRows = parseCsvText(text);

      if (parsedRows.length < 2) {
        throw new Error(
          'The CSV file must contain a header row and at least one ingredient row.'
        );
      }

      // Map header names case-insensitively
      const rawHeaders = parsedRows[0].map((h) => h.trim().toLowerCase());
      const getColIndex = (colName) => rawHeaders.indexOf(colName.toLowerCase());

      const requiredCols = ['supplier', 'suppliercode', 'productname', 'costperpack', 'packweightgrams'];
      const missingCols = requiredCols.filter((col) => getColIndex(col) === -1);

      if (missingCols.length > 0) {
        throw new Error(
          `Missing required CSV columns: ${missingCols.join(', ')}. Use the "CSV Template" button for the exact header format.`
        );
      }

      // Build lookup map of existing ingredients by supplierCode (case-insensitive)
      const existingByCode = {};
      ingredients.forEach((ing) => {
        if (ing.supplierCode) {
          existingByCode[ing.supplierCode.trim().toLowerCase()] = ing;
        }
      });

      const batch = writeBatch(db);
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (let r = 1; r < parsedRows.length; r++) {
        const row = parsedRows[r];
        const productName = row[getColIndex('productname')]?.trim() || '';
        const supplierCode = row[getColIndex('suppliercode')]?.trim() || '';
        const supplier = row[getColIndex('supplier')]?.trim() || 'General';

        if (!productName || !supplierCode) {
          skippedCount++;
          continue;
        }

        const caloriesPer100g = Number(row[getColIndex('caloriesper100g')]) || 0;
        const costPerPack = Number(row[getColIndex('costperpack')]) || 0;
        const rawWeight = Number(row[getColIndex('packweightgrams')]) || 0;
        const packWeightGrams = rawWeight > 0 ? rawWeight : 1; // Firestore rule requires > 0

        const rawInStock =
          getColIndex('instock') !== -1
            ? row[getColIndex('instock')]?.trim().toLowerCase()
            : 'true';
        const inStock = !['false', 'no', '0', 'oos', 'out of stock'].includes(rawInStock);

        const ingredientList =
          getColIndex('ingredientlist') !== -1
            ? row[getColIndex('ingredientlist')]?.trim() || productName
            : productName;

        // Parse 14 allergens + 4 cereals
        const allergens = createDefaultAllergens();
        CSV_ALLERGEN_KEYS.forEach((key) => {
          const idx = getColIndex(key);
          if (idx !== -1 && row[idx] !== undefined) {
            allergens[key] = normaliseAllergenValue(row[idx]);
          }
        });

        // Auto-escalate parent 'gluten' if any specific cereal is marked Yes or May Contain
        const cerealStates = GLUTEN_CEREALS.map((c) => allergens[c.key]);
        if (cerealStates.includes('Yes')) {
          allergens.gluten = 'Yes';
        } else if (
          cerealStates.includes('May Contain') &&
          allergens.gluten !== 'Yes'
        ) {
          allergens.gluten = 'May Contain';
        }

        const existingMatch = existingByCode[supplierCode.toLowerCase()];
        const docRef = existingMatch
          ? doc(db, 'ingredients', existingMatch.id)
          : doc(collection(db, 'ingredients'));

        if (existingMatch) {
          updatedCount++;
        } else {
          createdCount++;
        }

        batch.set(
          docRef,
          {
            supplier,
            supplierCode,
            productName,
            caloriesPer100g,
            costPerPack,
            packWeightGrams,
            ingredientList,
            inStock,
            allergens,
            lastVerifiedDate: serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (createdCount === 0 && updatedCount === 0) {
        throw new Error('No valid ingredient rows found to import.');
      }

      // Record bulk import in audit_logs
      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: `CSV Bulk Import (${file.name}): ${createdCount} created, ${updatedCount} updated${
          skippedCount > 0 ? `, ${skippedCount} skipped` : ''
        }`,
        userId: auth.currentUser?.uid || 'manager-session',
      });

      await batch.commit();

      setFeedback({
        type: 'success',
        text: `CSV Import complete! ${createdCount} new ingredient(s) added and ${updatedCount} existing ingredient(s) updated.`,
      });
    } catch (error) {
      console.error('CSV Import error:', error);
      setFeedback({
        type: 'error',
        text: `CSV Import failed: ${error.message}`,
      });
    } finally {
      setIsImportingCsv(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 8. Quick-Seed Sample Ingredients for testing a brand-new Firestore database
  const handleSeedDemoIngredients = async () => {
    const sampleItems = [
      {
        supplier: 'Brakes',
        supplierCode: 'BRK-10492',
        productName: 'Glazed Brioche Burger Bun (85g)',
        caloriesPer100g: 294,
        costPerPack: 14.4,
        packWeightGrams: 4080,
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
        packWeightGrams: 5424,
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
        ingredientList:
          'Pasteurised Cow MILK, Salt, Vegetarian Rennet, Starter Culture',
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
        packWeightGrams: 10000,
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
      setFeedback({
        type: 'error',
        text: `Failed to seed data: ${error.message}`,
      });
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
      {/* Header & CSV / CRUD Action Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">
            Ingredient &amp; Stock Inventory
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Manage supplier packs, 14-allergen profiles, CSV bulk imports, and live Out-of-Stock (OOS) dish dependencies.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Hidden File Input for CSV Upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleImportCsvFile}
            className="hidden"
          />

          {/* Download Blank CSV Template */}
          <button
            type="button"
            onClick={handleDownloadCsvTemplate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs shadow-2xs transition"
            title="Download a blank CSV template with headers and 1 example row"
          >
            <FileSpreadsheet className="w-4 h-4 text-slate-500" />
            CSV Template
          </button>

          {/* Import CSV Button */}
          <button
            type="button"
            disabled={isImportingCsv}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold text-xs shadow-2xs transition disabled:opacity-50"
            title="Bulk upload or update ingredients from a CSV file"
          >
            <Upload className="w-4 h-4 text-indigo-600" />
            {isImportingCsv ? 'Importing CSV...' : 'Import CSV'}
          </button>

          {/* Export CSV Button */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold text-xs shadow-2xs transition"
            title="Export all ingredients and allergen profiles to CSV"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            Export CSV
          </button>

          {ingredients.length === 0 && !loading && (
            <button
              type="button"
              onClick={handleSeedDemoIngredients}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-sm transition"
            >
              <Database className="w-4 h-4" />
              Seed 4 Sample Ingredients
            </button>
          )}

          <button
            type="button"
            onClick={() => openModal()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Add Ingredient
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
          <button
            onClick={() => setFeedback(null)}
            className="text-xs font-bold underline ml-4 shrink-0"
          >
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
                <th className="py-3.5 px-4">Ingredient &amp; Supplier</th>
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
                  (a) =>
                    ing.allergens?.[a.key] === 'Yes' ||
                    ing.allergens?.[a.key] === 'May Contain'
                );

                return (
                  <tr
                    key={ing.id}
                    className={
                      ing.inStock === false ? 'bg-red-50/60' : 'hover:bg-slate-50'
                    }
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
                      <div className="font-bold text-slate-900">
                        {ing.productName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {ing.supplier} • Code:{' '}
                        <span className="font-mono">{ing.supplierCode}</span> •{' '}
                        {ing.caloriesPer100g} kcal/100g
                      </div>
                    </td>

                    {/* Cost & Pack Size */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-800">
                        £{Number(ing.costPerPack).toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {ing.packWeightGrams}g pack
                      </div>
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
                {editingId
                  ? 'Edit Ingredient Specification'
                  : 'Add New Ingredient'}
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
                    onChange={(e) =>
                      setFormData({ ...formData, productName: e.target.value })
                    }
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
                    onChange={(e) =>
                      setFormData({ ...formData, supplier: e.target.value })
                    }
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
                    onChange={(e) =>
                      setFormData({ ...formData, supplierCode: e.target.value })
                    }
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
                    onChange={(e) =>
                      setFormData({ ...formData, costPerPack: e.target.value })
                    }
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
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        packWeightGrams: e.target.value,
                      })
                    }
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
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        caloriesPer100g: e.target.value,
                      })
                    }
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
                  onChange={(e) =>
                    setFormData({ ...formData, ingredientList: e.target.value })
                  }
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
                        <div className="text-[10px] uppercase opacity-80">
                          {status}
                        </div>
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
