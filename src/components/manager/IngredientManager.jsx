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
import {
  UK_ALLERGENS,
  GLUTEN_CEREALS,
  formatPPDSString,
} from './DishBuilder';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  PackageCheck,
  PackageX,
  X,
  Save,
  Download,
  Upload,
  FileSpreadsheet,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  Clock,
  ArrowLeftRight,
  Eye,
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

/**
 * Automatically strips common catering wholesaler brands and pack weights
 * so "Chef's Larder Mini Sausage Rolls (85g)" becomes "Mini Sausage Rolls" for the Kiosk.
 */
const WHOLESALE_BRAND_PREFIXES = [
  "chef's larder",
  "chefs larder",
  "chef’s larder",
  "brakes",
  "bidfood",
  "booker",
  "country range",
  "everyday favourites",
  "everyday value",
  "sysco",
  "jj foodservice",
  "farmfoods",
  "mccain",
  "lamb weston",
  "aviko",
  "heinz",
  "hellmann's",
  "hellmanns",
];

export const suggestCustomerFriendlyName = (rawKitchenName = '') => {
  if (!rawKitchenName) return '';
  let cleaned = rawKitchenName.trim();

  // Strip leading wholesale brand names (case-insensitive)
  WHOLESALE_BRAND_PREFIXES.forEach((brand) => {
    const regex = new RegExp(`^${brand}\\s+[-–—:]?\\s*`, 'i');
    cleaned = cleaned.replace(regex, '');
  });

  // Strip parenthesised pack weights or counts e.g. "(85g)", "(48 pack)", "(2.5kg)"
  cleaned = cleaned.replace(
    /\s*\(\s*\d+(\.\d+)?\s*(g|kg|ml|l|oz|pack|pk|pcs|slices|rolls)\s*\)/gi,
    ''
  );

  return cleaned.trim() || rawKitchenName.trim();
};

/**
 * Returns the customer-safe display name for Kiosk & PPDS labels.
 */
export const getCustomerFacingIngredientName = (ing) => {
  if (!ing) return '';
  if (ing.customerName && ing.customerName.trim() !== '') {
    return ing.customerName.trim();
  }
  return suggestCustomerFriendlyName(ing.productName || '');
};

/**
 * Evaluates a Firestore timestamp against the 90-day EHO review threshold.
 */
export const evaluateEhoReviewStatus = (timestamp) => {
  if (!timestamp) {
    return { status: 'OVERDUE', daysAgo: null, dateStr: 'Never verified' };
  }

  const verifiedDate = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);

  if (Number.isNaN(verifiedDate.getTime())) {
    return { status: 'OVERDUE', daysAgo: null, dateStr: 'Never verified' };
  }

  const now = new Date();
  const diffMs = now.getTime() - verifiedDate.getTime();
  const daysAgo = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const dateStr = verifiedDate.toLocaleDateString('en-GB');

  if (daysAgo >= 90) {
    return { status: 'OVERDUE', daysAgo, dateStr };
  }
  if (daysAgo >= 75) {
    return { status: 'DUE_SOON', daysAgo, dateStr };
  }
  return { status: 'VALID', daysAgo, dateStr };
};

/**
 * Resolves whether an ingredient is using its primary spec, an active in-stock backup, or is completely OOS.
 */
export const resolveEffectiveIngredient = (ingId, ingredientMap) => {
  const primary = ingredientMap[ingId];
  if (!primary) return { effectiveIng: null, isSwapped: false, isOos: true, primary: null };

  if (primary.inStock !== false) {
    return { effectiveIng: primary, isSwapped: false, isOos: false, primary };
  }

  if (primary.substituteId && ingredientMap[primary.substituteId]) {
    const backup = ingredientMap[primary.substituteId];
    if (backup.inStock !== false) {
      return {
        effectiveIng: backup,
        isSwapped: true,
        isOos: false,
        primary,
        backup,
      };
    }
  }

  return { effectiveIng: primary, isSwapped: false, isOos: true, primary };
};

/**
 * Recomputes a dish's aggregated allergens, calories, Natasha's Law PPDS text (using Customer-Friendly Names),
 * OOS status, and active substitutions using the latest ingredient map.
 */
export const recalculateDishPayload = (dish, ingredientMap) => {
  let totalCalories = 0;
  let hasOutOfStockIngredient = false;
  const activeSubstitutions = [];

  const aggregatedAllergens = createDefaultAllergens();

  const mergeAllergenState = (currentVal, incomingVal) => {
    if (currentVal === 'Yes' || incomingVal === 'Yes') return 'Yes';
    if (currentVal === 'May Contain' || incomingVal === 'May Contain')
      return 'May Contain';
    return 'No';
  };

  const validComponents = [];

  (dish.components || []).forEach((comp) => {
    const weight = parseFloat(comp.weightGrams) || 0;
    if (!comp.ingredientId || weight <= 0) return;

    const { effectiveIng, isSwapped, isOos, primary, backup } =
      resolveEffectiveIngredient(comp.ingredientId, ingredientMap);

    if (!effectiveIng) return;

    if (isOos) {
      hasOutOfStockIngredient = true;
    }

    if (isSwapped && primary && backup) {
      activeSubstitutions.push({
        primaryId: primary.id,
        primaryName: primary.productName,
        backupId: backup.id,
        backupName: backup.productName,
      });
    }

    validComponents.push({ ing: effectiveIng, weight });

    // Calories
    totalCalories += ((Number(effectiveIng.caloriesPer100g) || 0) / 100) * weight;

    // 14 Major Allergens
    const ingAllergens = effectiveIng.allergens || {};
    UK_ALLERGENS.forEach(({ key }) => {
      const val = ingAllergens[key] || 'No';
      aggregatedAllergens[key] = mergeAllergenState(
        aggregatedAllergens[key],
        val
      );
    });

    // 4 Gluten Cereals
    GLUTEN_CEREALS.forEach(({ key }) => {
      const val = ingAllergens[key] || ingAllergens.cereals?.[key] || 'No';
      aggregatedAllergens[key] = mergeAllergenState(
        aggregatedAllergens[key],
        val
      );
      if (val === 'Yes' || val === 'May Contain') {
        aggregatedAllergens.gluten = mergeAllergenState(
          aggregatedAllergens.gluten,
          val
        );
      }
    });
  });

  // Preserve shared fryer / prep surface cross-contamination traces on the dish
  (dish.crossContamAllergens || []).forEach((key) => {
    aggregatedAllergens[key] = mergeAllergenState(
      aggregatedAllergens[key],
      'May Contain'
    );
    if (GLUTEN_CEREALS.some((c) => c.key === key)) {
      aggregatedAllergens.gluten = mergeAllergenState(
        aggregatedAllergens.gluten,
        'May Contain'
      );
    }
  });

  // Rebuild Natasha's Law (PPDS) string using the Customer-Friendly Kiosk Name (hiding supplier brands)
  const sortedForPpds = [...validComponents].sort((a, b) => b.weight - a.weight);
  let rawCompositeIngredients = sortedForPpds
    .map(({ ing }) => {
      const publicName = getCustomerFacingIngredientName(ing);
      return `${publicName} (${ing.ingredientList || publicName})`;
    })
    .join(', ');

  if ((dish.crossContamAllergens || []).length > 0 && rawCompositeIngredients) {
    const traceLabels = dish.crossContamAllergens.map((key) => {
      const found = [...UK_ALLERGENS, ...GLUTEN_CEREALS].find(
        (a) => a.key === key
      );
      return found ? found.label : key;
    });
    rawCompositeIngredients += `. Cooked in a kitchen area/fryer that handles ${traceLabels.join(
      ', '
    )}`;
  }

  const ppdsFormatted = formatPPDSString(rawCompositeIngredients);

  return {
    totalCalories: Math.round(totalCalories),
    allergens: aggregatedAllergens,
    ppdsIngredientText: ppdsFormatted.plainText,
    hasOutOfStockIngredient,
    activeSubstitutions,
    updatedAt: serverTimestamp(),
  };
};

// ============================================================================
// SMART INGREDIENT TEXT PARSER (14 Major Allergens + 4 Gluten Cereals)
// ============================================================================

const FALSE_POSITIVE_PHRASES = [
  'nutmeg',
  'butternut',
  'coconut',
  'coconuts',
  'water chestnut',
  'water chestnuts',
  'horse chestnut',
  'chestnut',
  'chestnuts',
  'pine nut',
  'pine nuts',
  'pine kernel',
  'cocoa butter',
  'shea butter',
  'illipe butter',
  'kokum butter',
  'mango butter',
  'sal butter',
  'cream of tartar',
  'coconut milk',
  'coconut cream',
  'lactic acid',
  'calcium lactate',
  'sodium lactate',
  'milk thistle',
  'buckwheat',
  'gluten free',
  'gluten-free',
  'dairy free',
  'dairy-free',
];

const ALLERGEN_DETECTION_MAP = {
  wheat: [
    'wheat', 'spelt', 'kamut', 'khorasan', 'durum', 'semolina',
    'couscous', 'bulgur', 'farro', 'triticale',
  ],
  barley: ['barley', 'malt extract', 'malted'],
  rye: ['rye'],
  oats: ['oat', 'oats', 'oatmeal'],
  gluten: [
    'gluten', 'wheat', 'barley', 'rye', 'oat', 'oats', 'oatmeal',
    'spelt', 'kamut', 'khorasan', 'durum', 'semolina', 'couscous', 'bulgur', 'triticale',
  ],
  celery: ['celery', 'celeriac'],
  crustaceans: [
    'crustacean', 'crustaceans', 'prawn', 'prawns', 'shrimp', 'shrimps',
    'crab', 'lobster', 'crayfish', 'crawfish', 'scampi', 'langoustine', 'krill',
  ],
  eggs: [
    'egg', 'eggs', 'albumen', 'albumin', 'ovalbumin', 'globulin',
    'ovomucoid', 'livetin', 'lysozyme', 'mayonnaise', 'meringue',
  ],
  fish: [
    'fish', 'cod', 'haddock', 'plaice', 'pollock', 'coley', 'salmon',
    'tuna', 'anchovy', 'anchovies', 'sardine', 'sardines', 'pilchard',
    'mackerel', 'trout', 'sea bass', 'seabass', 'hake', 'halibut',
    'sole', 'turbot', 'swordfish', 'kipper', 'herring', 'sprat',
    'whitebait', 'roe', 'caviar', 'isinglass',
  ],
  lupin: ['lupin', 'lupine', 'lupins', 'lupini'],
  milk: [
    'milk', 'butter', 'cream', 'cheese', 'whey', 'casein', 'caseinate',
    'caseinates', 'lactose', 'lactoglobulin', 'lactalbumin', 'buttermilk',
    'yoghurt', 'yogurt', 'ghee', 'paneer', 'curd', 'curds', 'mozzarella',
    'cheddar', 'parmesan', 'gouda', 'edam', 'brie', 'stilton', 'mascarpone',
    'ricotta', 'halloumi', 'feta', 'monterey jack', 'dairy',
  ],
  molluscs: [
    'mollusc', 'molluscs', 'mollusk', 'mollusks', 'mussel', 'mussels',
    'oyster', 'oysters', 'squid', 'calamari', 'octopus', 'clam', 'clams',
    'scallop', 'scallops', 'cockle', 'cockles', 'whelk', 'whelks',
    'winkles', 'periwinkle', 'abalone', 'snail', 'snails', 'escargot', 'cuttlefish',
  ],
  mustard: ['mustard'],
  nuts: [
    'tree nut', 'tree nuts', 'nuts', 'nut', 'almond', 'almonds',
    'hazelnut', 'hazelnuts', 'filbert', 'walnut', 'walnuts', 'cashew',
    'cashews', 'pecan', 'pecans', 'brazil nut', 'brazil nuts', 'pistachio',
    'pistachios', 'macadamia', 'queensland nut', 'praline', 'marzipan', 'frangipane', 'gianduja',
  ],
  peanuts: [
    'peanut', 'peanuts', 'groundnut', 'groundnuts', 'monkey nut', 'arachis',
  ],
  sesame: ['sesame', 'tahini', 'gingelly'],
  soya: [
    'soya', 'soy', 'soybean', 'soybeans', 'soya bean', 'soya beans',
    'edamame', 'tofu', 'tempeh', 'miso', 'natto', 'kinako',
  ],
  sulphites: [
    'sulphite', 'sulphites', 'sulfite', 'sulfites', 'sulphur dioxide',
    'sulfur dioxide', 'metabisulphite', 'metabisulfite', 'sodium metabisulphite',
    'potassium metabisulphite', 'e220', 'e221', 'e222', 'e223', 'e224',
    'e225', 'e226', 'e227', 'e228',
  ],
};

const COMPILED_ALLERGEN_REGEXES = Object.fromEntries(
  Object.entries(ALLERGEN_DETECTION_MAP).map(([key, words]) => {
    const pattern = words
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length)
      .join('|');
    return [key, new RegExp(`\\b(${pattern})\\b`, 'i')];
  })
);

const TRACE_SPLIT_REGEX =
  /(?:may\s+(?:also\s+)?contain(?:\s+traces\s+of)?|traces\s+of|not\s+suitable\s+for\s+.*?\s+allergy|produced\s+in\s+a\s+(?:factory|facility|site|environment)\s+that\s+(?:also\s+)?handles|made\s+on\s+a\s+line\s+that\s+handles|manufactured\s+on\s+equipment\s+that\s+processes)/i;

export const detectAllergensFromIngredientText = (rawText) => {
  const detected = createDefaultAllergens();
  if (!rawText || !rawText.trim()) return detected;

  let sanitisedText = rawText.toLowerCase();
  FALSE_POSITIVE_PHRASES.forEach((phrase) => {
    const safeRegex = new RegExp(`\\b${phrase}\\b`, 'gi');
    sanitisedText = sanitisedText.replace(safeRegex, ' ');
  });

  const parts = sanitisedText.split(TRACE_SPLIT_REGEX);
  const mainIngredientsText = parts[0] || '';
  const mayContainText = parts.slice(1).join(' ');

  Object.entries(COMPILED_ALLERGEN_REGEXES).forEach(([allergenKey, regex]) => {
    if (regex.test(mainIngredientsText)) {
      detected[allergenKey] = 'Yes';
    }
  });

  if (mayContainText) {
    Object.entries(COMPILED_ALLERGEN_REGEXES).forEach(([allergenKey, regex]) => {
      if (detected[allergenKey] !== 'Yes' && regex.test(mayContainText)) {
        detected[allergenKey] = 'May Contain';
      }
    });
  }

  const cerealStates = GLUTEN_CEREALS.map((c) => detected[c.key]);
  if (cerealStates.includes('Yes')) {
    detected.gluten = 'Yes';
  } else if (cerealStates.includes('May Contain') && detected.gluten !== 'Yes') {
    detected.gluten = 'May Contain';
  }

  return detected;
};

const INITIAL_FORM_STATE = {
  supplier: '',
  supplierCode: '',
  productName: '', // Internal Kitchen / Supplier Name (e.g. "Chef's Larder Mini Sausage Rolls")
  customerName: '', // Public Kiosk / PPDS Name (e.g. "Mini Sausage Rolls")
  caloriesPer100g: '',
  costPerPack: '',
  packWeightGrams: '',
  ingredientList: '',
  inStock: true,
  substituteId: '',
  allergens: createDefaultAllergens(),
};

const CSV_BASE_HEADERS = [
  'supplier',
  'supplierCode',
  'productName',
  'customerName',
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

const escapeCsvCell = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

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
        i++;
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

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
};

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
  const [filterStock, setFilterStock] = useState('ALL');

  // Modal / Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);
  const [customerNameManuallyEdited, setCustomerNameManuallyEdited] = useState(false);
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fileInputRef = useRef(null);

  // 1. Subscribe to both Ingredients and Dishes
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

  const ingredientMap = useMemo(() => {
    const map = {};
    ingredients.forEach((ing) => {
      map[ing.id] = ing;
    });
    return map;
  }, [ingredients]);

  // 2. Map Ingredient ID -> Array of Dishes that rely on it
  const dependencyMap = useMemo(() => {
    const map = {};
    dishes.forEach((dish) => {
      (dish.components || []).forEach((comp) => {
        const primaryId = comp.ingredientId;
        if (!primaryId) return;

        if (!map[primaryId]) map[primaryId] = [];
        if (!map[primaryId].some((d) => d.id === dish.id)) {
          map[primaryId].push(dish);
        }

        const primaryIng = ingredientMap[primaryId];
        if (primaryIng?.substituteId) {
          const backupId = primaryIng.substituteId;
          if (!map[backupId]) map[backupId] = [];
          if (!map[backupId].some((d) => d.id === dish.id)) {
            map[backupId].push(dish);
          }
        }
      });
    });
    return map;
  }, [dishes, ingredientMap]);

  const ehoDueCount = useMemo(() => {
    return ingredients.filter((ing) => {
      const { status } = evaluateEhoReviewStatus(ing.lastVerifiedDate);
      return status === 'OVERDUE' || status === 'DUE_SOON';
    }).length;
  }, [ingredients]);

  // 1-Click EHO Spec Verification Handler
  const handleVerifyIngredientSpec = async (ingredient) => {
    try {
      const batch = writeBatch(db);
      const ingRef = doc(db, 'ingredients', ingredient.id);
      batch.update(ingRef, {
        lastVerifiedDate: serverTimestamp(),
      });

      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: `EHO 90-Day Spec Verified: "${ingredient.productName}" (${ingredient.supplierCode})`,
        userId: auth.currentUser?.uid || 'manager-session',
      });

      await batch.commit();
      setFeedback({
        type: 'success',
        text: `EHO specification date verified for "${ingredient.productName}" (valid for 90 days).`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: `Could not verify spec: ${error.message}`,
      });
    }
  };

  // Handle typing into Kitchen / Supplier Product Name (auto-suggests clean Customer Name)
  const handleKitchenNameChange = (newKitchenName) => {
    setFormData((prev) => ({
      ...prev,
      productName: newKitchenName,
      customerName: customerNameManuallyEdited
        ? prev.customerName
        : suggestCustomerFriendlyName(newKitchenName),
    }));
  };

  // Handle typing or pasting into the Supplier Sub-Ingredients textarea
  const handleIngredientListChange = (newText) => {
    setFormData((prev) => {
      let updatedProductName = prev.productName;
      let updatedCustomerName = prev.customerName;
      let cleanedText = newText;

      if (!prev.productName.trim() && newText.includes(':')) {
        const colonIndex = newText.indexOf(':');
        if (colonIndex > 2 && colonIndex < 60) {
          updatedProductName = newText.slice(0, colonIndex).trim();
          if (!customerNameManuallyEdited) {
            updatedCustomerName = suggestCustomerFriendlyName(updatedProductName);
          }
          cleanedText = newText.slice(colonIndex + 1).trim();
        }
      }

      const nextAllergens = autoDetectEnabled
        ? detectAllergensFromIngredientText(cleanedText)
        : prev.allergens;

      return {
        ...prev,
        productName: updatedProductName,
        customerName: updatedCustomerName,
        ingredientList: cleanedText,
        allergens: nextAllergens,
      };
    });
  };

  const handleRescanAllergens = () => {
    const scanned = detectAllergensFromIngredientText(formData.ingredientList);
    setFormData((prev) => ({
      ...prev,
      allergens: scanned,
    }));
  };

  const handleCycleAllergen = (key) => {
    const order = ['No', 'May Contain', 'Yes'];
    setFormData((prev) => {
      const current = prev.allergens[key] || 'No';
      const next = order[(order.indexOf(current) + 1) % order.length];
      const updatedAllergens = { ...prev.allergens, [key]: next };

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

  const modalAllergenSummary = useMemo(() => {
    const allItems = [...UK_ALLERGENS, ...GLUTEN_CEREALS];
    const yesList = allItems
      .filter((item) => formData.allergens[item.key] === 'Yes')
      .map((item) => item.label);
    const mayList = allItems
      .filter((item) => formData.allergens[item.key] === 'May Contain')
      .map((item) => item.label);
    return { yesList, mayList };
  }, [formData.allergens]);

  const openModal = (ingredient = null) => {
    if (ingredient) {
      setEditingId(ingredient.id);
      setCustomerNameManuallyEdited(Boolean(ingredient.customerName));
      setFormData({
        supplier: ingredient.supplier || '',
        supplierCode: ingredient.supplierCode || '',
        productName: ingredient.productName || '',
        customerName:
          ingredient.customerName ||
          suggestCustomerFriendlyName(ingredient.productName || ''),
        caloriesPer100g: ingredient.caloriesPer100g ?? '',
        costPerPack: ingredient.costPerPack ?? '',
        packWeightGrams: ingredient.packWeightGrams ?? '',
        ingredientList: ingredient.ingredientList || '',
        inStock: ingredient.inStock ?? true,
        substituteId: ingredient.substituteId || '',
        allergens: { ...createDefaultAllergens(), ...(ingredient.allergens || {}) },
      });
    } else {
      setEditingId(null);
      setCustomerNameManuallyEdited(false);
      setFormData(INITIAL_FORM_STATE);
    }
    setIsModalOpen(true);
  };

  // 3. Instant Stock / Backup Swap Toggle + Full Multi-Dish Allergen & PPDS Cascade
  const handleToggleStock = async (ingredient) => {
    const newStockState = !ingredient.inStock;
    const affectedDishes = dependencyMap[ingredient.id] || [];

    const updatedIngredientMap = {
      ...ingredientMap,
      [ingredient.id]: {
        ...ingredient,
        inStock: newStockState,
      },
    };

    const backupIng = ingredient.substituteId
      ? updatedIngredientMap[ingredient.substituteId]
      : null;
    const isSwappingToBackup =
      !newStockState && backupIng && backupIng.inStock !== false;

    try {
      const batch = writeBatch(db);
      const ingRef = doc(db, 'ingredients', ingredient.id);

      batch.update(ingRef, {
        inStock: newStockState,
      });

      affectedDishes.forEach((dish) => {
        const recalculated = recalculateDishPayload(dish, updatedIngredientMap);
        batch.update(doc(db, 'dishes', dish.id), recalculated);
      });

      const auditRef = doc(collection(db, 'audit_logs'));
      let actionDescription = '';
      if (isSwappingToBackup) {
        actionDescription = `Marked "${ingredient.productName}" Out of Stock — Auto-Swapped ${affectedDishes.length} dish(es) to backup "${backupIng.productName}" (allergens & PPDS updated)`;
      } else if (newStockState && backupIng) {
        actionDescription = `Restored "${ingredient.productName}" to In Stock — Reverted ${affectedDishes.length} dish(es) from backup "${backupIng.productName}" to primary spec`;
      } else {
        actionDescription = `Marked ingredient "${ingredient.productName}" as ${
          newStockState ? 'IN STOCK' : 'OUT OF STOCK'
        } (${affectedDishes.length} menu dishes updated)`;
      }

      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: actionDescription,
        userId: auth.currentUser?.uid || 'manager-session',
      });

      await batch.commit();

      setFeedback({
        type: isSwappingToBackup
          ? 'warning'
          : newStockState
          ? 'success'
          : 'warning',
        text: actionDescription,
      });
    } catch (error) {
      console.error('Error toggling stock:', error);
      setFeedback({ type: 'error', text: `Stock update failed: ${error.message}` });
    }
  };

  // 4. Save New or Edited Ingredient + Cascade Customer Name & Allergens to Dependent Dishes
  const handleSaveIngredient = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const batch = writeBatch(db);
      const ingRef = editingId
        ? doc(db, 'ingredients', editingId)
        : doc(collection(db, 'ingredients'));

      const cleanKitchenName = formData.productName.trim();
      const cleanCustomerName =
        formData.customerName.trim() ||
        suggestCustomerFriendlyName(cleanKitchenName);

      const payload = {
        supplier: formData.supplier.trim(),
        supplierCode: formData.supplierCode.trim(),
        productName: cleanKitchenName,
        customerName: cleanCustomerName,
        caloriesPer100g: Number(formData.caloriesPer100g),
        costPerPack: Number(formData.costPerPack),
        packWeightGrams: Number(formData.packWeightGrams),
        ingredientList: formData.ingredientList.trim(),
        inStock: Boolean(formData.inStock),
        substituteId: formData.substituteId || null,
        allergens: formData.allergens,
        lastVerifiedDate: serverTimestamp(),
      };

      batch.set(ingRef, payload, { merge: true });

      const affectedDishes = editingId ? dependencyMap[editingId] || [] : [];
      if (editingId && affectedDishes.length > 0) {
        const updatedIngredientMap = {
          ...ingredientMap,
          [editingId]: { id: editingId, ...payload },
        };
        affectedDishes.forEach((dish) => {
          const recalculated = recalculateDishPayload(dish, updatedIngredientMap);
          batch.update(doc(db, 'dishes', dish.id), recalculated);
        });
      }

      const backupName = payload.substituteId
        ? ingredientMap[payload.substituteId]?.productName
        : null;

      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        timestamp: serverTimestamp(),
        action: editingId
          ? `Updated ingredient "${payload.productName}" (Kiosk Name: "${payload.customerName}")${
              backupName ? ` [Backup: "${backupName}"]` : ''
            }`
          : `Created ingredient "${payload.productName}" (Kiosk Name: "${payload.customerName}")`,
        userId: auth.currentUser?.uid || 'manager-session',
      });

      await batch.commit();
      setIsModalOpen(false);
      setFeedback({
        type: 'success',
        text: `Saved "${payload.productName}" (displayed to customers as "${payload.customerName}")${
          affectedDishes.length > 0
            ? ` and updated ${affectedDishes.length} linked dish(es).`
            : '.'
        }`,
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
        text: `Cannot delete "${ingredient.productName}" because it is linked to: ${usedIn
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

  // 5. CSV Export (Includes customerName column)
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
        escapeCsvCell(getCustomerFacingIngredientName(ing)),
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

  // 6. Download Blank CSV Template
  const handleDownloadCsvTemplate = () => {
    const sampleRow = [
      'Booker',
      'BKR-44910',
      "Chef's Larder Mini Sausage Rolls (48 Pack)",
      'Mini Sausage Rolls',
      '325',
      '12.99',
      '1440',
      'true',
      escapeCsvCell(
        'Water, WHEAT Flour, Pork (9%), Rusk (WHEAT Flour), Salt. May also contain Barley, Eggs, Milk, Mustard and Oats.'
      ),
      'No', 'Yes', 'No', 'May Contain', 'No', 'No', 'May Contain', 'No', 'May Contain', 'No', 'No', 'No', 'No', 'No', 'Yes', 'May Contain', 'No', 'May Contain',
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

  // 7. CSV Bulk Import (Supports optional customerName column or auto-generates it)
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

      const rawHeaders = parsedRows[0].map((h) => h.trim().toLowerCase());
      const getColIndex = (colName) => rawHeaders.indexOf(colName.toLowerCase());

      const requiredCols = ['supplier', 'suppliercode', 'productname', 'costperpack', 'packweightgrams'];
      const missingCols = requiredCols.filter((col) => getColIndex(col) === -1);

      if (missingCols.length > 0) {
        throw new Error(
          `Missing required CSV columns: ${missingCols.join(', ')}. Use the "CSV Template" button for the exact header format.`
        );
      }

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

        const rawCustomerName =
          getColIndex('customername') !== -1
            ? row[getColIndex('customername')]?.trim() || ''
            : '';
        const customerName =
          rawCustomerName || suggestCustomerFriendlyName(productName);

        const caloriesPer100g = Number(row[getColIndex('caloriesper100g')]) || 0;
        const costPerPack = Number(row[getColIndex('costperpack')]) || 0;
        const rawWeight = Number(row[getColIndex('packweightgrams')]) || 0;
        const packWeightGrams = rawWeight > 0 ? rawWeight : 1;

        const rawInStock =
          getColIndex('instock') !== -1
            ? row[getColIndex('instock')]?.trim().toLowerCase()
            : 'true';
        const inStock = !['false', 'no', '0', 'oos', 'out of stock'].includes(rawInStock);

        const ingredientList =
          getColIndex('ingredientlist') !== -1
            ? row[getColIndex('ingredientlist')]?.trim() || customerName
            : customerName;

        const autoDetected = detectAllergensFromIngredientText(ingredientList);
        const allergens = { ...autoDetected };

        CSV_ALLERGEN_KEYS.forEach((key) => {
          const idx = getColIndex(key);
          if (idx !== -1 && row[idx] !== undefined && row[idx].trim() !== '') {
            const explicitVal = normaliseAllergenValue(row[idx]);
            if (explicitVal === 'Yes' || explicitVal === 'May Contain') {
              allergens[key] = explicitVal;
            }
          }
        });

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
            customerName,
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

  // Filtered Ingredients list
  const filteredIngredients = useMemo(() => {
    return ingredients.filter((ing) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        ing.productName?.toLowerCase().includes(q) ||
        ing.customerName?.toLowerCase().includes(q) ||
        ing.supplierCode?.toLowerCase().includes(q) ||
        ing.supplier?.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      const { isSwapped, isOos } = resolveEffectiveIngredient(
        ing.id,
        ingredientMap
      );

      if (filterStock === 'IN_STOCK') return ing.inStock !== false;
      if (filterStock === 'SWAPPED') return isSwapped;
      if (filterStock === 'OOS') return isOos;
      if (filterStock === 'EHO_DUE') {
        const { status } = evaluateEhoReviewStatus(ing.lastVerifiedDate);
        return status === 'OVERDUE' || status === 'DUE_SOON';
      }
      return true;
    });
  }, [ingredients, ingredientMap, searchQuery, filterStock]);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 bg-slate-50 min-h-screen">
      {/* Header & CSV / CRUD Action Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">
            Ingredient, Backup Swap &amp; EHO Inventory
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Manage kitchen supplier specs, customer-friendly Kiosk names, global backup swaps, and 90-day EHO checks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            id="csv-file-upload"
            name="csvFileUpload"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleImportCsvFile}
            className="hidden"
          />

          <button
            type="button"
            onClick={handleDownloadCsvTemplate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs shadow-2xs transition"
          >
            <FileSpreadsheet className="w-4 h-4 text-slate-500" />
            CSV Template
          </button>

          <button
            type="button"
            disabled={isImportingCsv}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold text-xs shadow-2xs transition disabled:opacity-50"
          >
            <Upload className="w-4 h-4 text-indigo-600" />
            {isImportingCsv ? 'Importing CSV...' : 'Import CSV'}
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold text-xs shadow-2xs transition"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            Export CSV
          </button>

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

      {/* EHO 90-Day Review Alert Banner */}
      {ehoDueCount > 0 && (
        <div className="mt-4 p-4 rounded-xl bg-amber-50 border-2 border-amber-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-amber-950">
                EHO 90-Day Specification Review Notice
              </h3>
              <p className="text-xs text-amber-900 mt-0.5">
                <strong>{ehoDueCount}</strong> ingredient specification(s) are approaching or past the 90-day verification window.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              setFilterStock(filterStock === 'EHO_DUE' ? 'ALL' : 'EHO_DUE')
            }
            className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-extrabold shrink-0 transition"
          >
            {filterStock === 'EHO_DUE'
              ? 'Show All Ingredients'
              : `Filter ${ehoDueCount} Due Item(s)`}
          </button>
        </div>
      )}

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
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-bold underline ml-4 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Stock / Swap Filter Bar */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-96">
          <label htmlFor="ingredient-search" className="sr-only">
            Search ingredients
          </label>
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            id="ingredient-search"
            name="ingredientSearch"
            type="text"
            autoComplete="off"
            placeholder="Search kitchen name, kiosk name, supplier, or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {[
            { id: 'ALL', label: `All (${ingredients.length})` },
            { id: 'IN_STOCK', label: 'In Stock' },
            { id: 'SWAPPED', label: 'Swapped to Backup' },
            { id: 'OOS', label: 'Out of Stock (No Backup)' },
            { id: 'EHO_DUE', label: `EHO Review Due (${ehoDueCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterStock(tab.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                filterStock === tab.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {tab.label}
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
                <th className="py-3.5 px-4">Stock / Swap Status</th>
                <th className="py-3.5 px-4">Kitchen Name &amp; Kiosk Display Name</th>
                <th className="py-3.5 px-4">Pack Cost / Weight</th>
                <th className="py-3.5 px-4">EHO 90-Day Check</th>
                <th className="py-3.5 px-4">Active Allergens</th>
                <th className="py-3.5 px-4">Menu Dependencies</th>
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
                const ehoStatus = evaluateEhoReviewStatus(ing.lastVerifiedDate);
                const { isSwapped, isOos } = resolveEffectiveIngredient(
                  ing.id,
                  ingredientMap
                );
                const configuredBackup = ing.substituteId
                  ? ingredientMap[ing.substituteId]
                  : null;
                const publicKioskName = getCustomerFacingIngredientName(ing);

                return (
                  <tr
                    key={ing.id}
                    className={
                      isSwapped
                        ? 'bg-indigo-50/60'
                        : isOos
                        ? 'bg-red-50/60'
                        : 'hover:bg-slate-50'
                    }
                  >
                    {/* Stock / Swap Toggle Button */}
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        onClick={() => handleToggleStock(ing)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                          isSwapped
                            ? 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
                            : isOos
                            ? 'bg-red-600 text-white shadow-sm hover:bg-red-700'
                            : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        }`}
                      >
                        {isSwapped ? (
                          <>
                            <ArrowLeftRight className="w-4 h-4" />
                            SWAPPED TO BACKUP
                          </>
                        ) : isOos ? (
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

                    {/* Kitchen Name, Customer Kiosk Name & Linked Backup */}
                    <td className="py-3.5 px-4 space-y-1">
                      <div className="font-bold text-slate-900">
                        {ing.productName}
                      </div>

                      {/* Customer-Friendly Kiosk Name Badge */}
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold">
                        <Eye className="w-3 h-3 text-emerald-600 shrink-0" />
                        <span>Kiosk Name: <strong>{publicKioskName}</strong></span>
                      </div>

                      <div className="text-xs text-slate-500">
                        {ing.supplier} • Code:{' '}
                        <span className="font-mono">{ing.supplierCode}</span> •{' '}
                        {ing.caloriesPer100g} kcal/100g
                      </div>

                      {configuredBackup && (
                        <div
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold border ${
                            isSwapped
                              ? 'bg-indigo-600 text-white border-indigo-700'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          <ArrowLeftRight className="w-3 h-3 shrink-0" />
                          <span>
                            {isSwapped ? 'ACTIVE SWAP:' : 'Backup:'}{' '}
                            {configuredBackup.productName} ({configuredBackup.supplier})
                          </span>
                        </div>
                      )}
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

                    {/* EHO 90-Day Traffic Light */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                            ehoStatus.status === 'VALID'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : ehoStatus.status === 'DUE_SOON'
                              ? 'bg-amber-100 text-amber-950 border-amber-400'
                              : 'bg-red-100 text-red-900 border-red-400'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              ehoStatus.status === 'VALID'
                                ? 'bg-emerald-500'
                                : ehoStatus.status === 'DUE_SOON'
                                ? 'bg-amber-500'
                                : 'bg-red-600'
                            }`}
                          />
                          {ehoStatus.status === 'VALID'
                            ? `Verified (${ehoStatus.daysAgo}d ago)`
                            : ehoStatus.status === 'DUE_SOON'
                            ? `Due Soon (${ehoStatus.daysAgo}d ago)`
                            : ehoStatus.daysAgo !== null
                            ? `Overdue (${ehoStatus.daysAgo}d ago)`
                            : 'Unverified'}
                        </span>

                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span>Checked: {ehoStatus.dateStr}</span>
                          <button
                            type="button"
                            onClick={() => handleVerifyIngredientSpec(ing)}
                            className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 font-bold underline"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            Verify Today
                          </button>
                        </div>
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
                                isSwapped
                                  ? 'bg-indigo-100 text-indigo-900 border border-indigo-300 font-bold'
                                  : isOos
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
                          title="Edit Ingredient or Customer Name"
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
                  ? 'Edit Ingredient & Customer Kiosk Name'
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
              {/* Supplier Sub-Ingredients List */}
              <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-200 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="ingredient-list"
                    className="text-xs font-extrabold uppercase text-indigo-950 flex items-center gap-1.5"
                  >
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    Paste Supplier Ingredients List (Auto-Detects Allergens) *
                  </label>

                  <div className="flex items-center gap-3">
                    <label
                      htmlFor="auto-detect-allergens"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-900 cursor-pointer"
                    >
                      <input
                        id="auto-detect-allergens"
                        name="autoDetectAllergens"
                        type="checkbox"
                        checked={autoDetectEnabled}
                        onChange={(e) => setAutoDetectEnabled(e.target.checked)}
                        className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      Auto-select allergens on paste
                    </label>

                    <button
                      type="button"
                      onClick={handleRescanAllergens}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-bold transition"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Re-scan Text
                    </button>
                  </div>
                </div>

                <textarea
                  id="ingredient-list"
                  name="ingredientList"
                  rows={3}
                  required
                  placeholder="Paste directly from spec sheet, e.g.: Chef's Larder Mini Sausage Rolls: Water, Wheat Flour, Pork (9%)..."
                  value={formData.ingredientList}
                  onChange={(e) => handleIngredientListChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-indigo-300 bg-white text-sm focus:ring-2 focus:ring-indigo-600"
                />

                {formData.ingredientList.trim() && (
                  <div className="p-2.5 rounded-xl bg-white border border-indigo-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div>
                        <span className="font-bold text-red-600">
                          Contains (Yes):{' '}
                        </span>
                        <span className="font-semibold text-slate-800">
                          {modalAllergenSummary.yesList.length > 0
                            ? modalAllergenSummary.yesList.join(', ')
                            : 'None detected'}
                        </span>
                      </div>
                      <div>
                        <span className="font-bold text-amber-600">
                          May Contain:{' '}
                        </span>
                        <span className="font-semibold text-slate-800">
                          {modalAllergenSummary.mayList.length > 0
                            ? modalAllergenSummary.mayList.join(', ')
                            : 'None detected'}
                        </span>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg shrink-0">
                      Please verify pills below before saving
                    </span>
                  </div>
                )}
              </div>

              {/* Dual Name Inputs: Kitchen/Supplier Name vs Customer Kiosk Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <div>
                  <label
                    htmlFor="product-name"
                    className="block text-xs font-bold uppercase text-slate-700 mb-1"
                  >
                    Kitchen / Supplier Product Name (Staff Only) *
                  </label>
                  <input
                    id="product-name"
                    name="productName"
                    type="text"
                    autoComplete="off"
                    required
                    placeholder="e.g. Chef's Larder Mini Sausage Rolls"
                    value={formData.productName}
                    onChange={(e) => handleKitchenNameChange(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-900"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Shown to managers and kitchen staff in stock lists &amp; Dish Builder.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="customer-name"
                    className="block text-xs font-bold uppercase text-emerald-800 mb-1 flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5 text-emerald-600" />
                    Customer-Friendly Name (Kiosk &amp; PPDS Labels) *
                  </label>
                  <input
                    id="customer-name"
                    name="customerName"
                    type="text"
                    autoComplete="off"
                    required
                    placeholder="e.g. Mini Sausage Rolls"
                    value={formData.customerName}
                    onChange={(e) => {
                      setCustomerNameManuallyEdited(true);
                      setFormData({ ...formData, customerName: e.target.value });
                    }}
                    className="w-full px-3.5 py-2 rounded-xl border-2 border-emerald-300 bg-white text-sm font-bold text-emerald-950 focus:ring-2 focus:ring-emerald-600"
                  />
                  <p className="text-[11px] text-emerald-700 mt-1">
                    Hides brands like &ldquo;Chef&apos;s Larder&rdquo; from customers on the Kiosk.
                  </p>
                </div>
              </div>

              {/* Commercial & Nutritional Metadata Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="supplier-name"
                    className="block text-xs font-bold uppercase text-slate-600 mb-1"
                  >
                    Supplier *
                  </label>
                  <input
                    id="supplier-name"
                    name="supplier"
                    type="text"
                    autoComplete="organization"
                    required
                    placeholder="e.g. Booker / Brakes / Bidfood"
                    value={formData.supplier}
                    onChange={(e) =>
                      setFormData({ ...formData, supplier: e.target.value })
                    }
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="supplier-code"
                    className="block text-xs font-bold uppercase text-slate-600 mb-1"
                  >
                    Supplier Code *
                  </label>
                  <input
                    id="supplier-code"
                    name="supplierCode"
                    type="text"
                    autoComplete="off"
                    required
                    value={formData.supplierCode}
                    onChange={(e) =>
                      setFormData({ ...formData, supplierCode: e.target.value })
                    }
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-mono"
                  />
                </div>

                <div>
                  <label
                    htmlFor="calories-per-100g"
                    className="block text-xs font-bold uppercase text-slate-600 mb-1"
                  >
                    Calories per 100g (kcal) *
                  </label>
                  <input
                    id="calories-per-100g"
                    name="caloriesPer100g"
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

                <div>
                  <label
                    htmlFor="cost-per-pack"
                    className="block text-xs font-bold uppercase text-slate-600 mb-1"
                  >
                    Cost Per Pack (£) *
                  </label>
                  <input
                    id="cost-per-pack"
                    name="costPerPack"
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
                  <label
                    htmlFor="pack-weight-grams"
                    className="block text-xs font-bold uppercase text-slate-600 mb-1"
                  >
                    Pack Weight (Grams) *
                  </label>
                  <input
                    id="pack-weight-grams"
                    name="packWeightGrams"
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

                {/* Global Backup / Substitute Ingredient Selector */}
                <div className="sm:col-span-3">
                  <label
                    htmlFor="substitute-ingredient"
                    className="block text-xs font-bold uppercase text-indigo-700 mb-1 flex items-center gap-1.5"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    Backup / Substitute Ingredient (Auto-Swaps Across Dishes When OOS)
                  </label>
                  <select
                    id="substitute-ingredient"
                    name="substituteId"
                    value={formData.substituteId}
                    onChange={(e) =>
                      setFormData({ ...formData, substituteId: e.target.value })
                    }
                    className="w-full px-3.5 py-2 rounded-xl border-2 border-indigo-200 bg-indigo-50/40 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-indigo-600"
                  >
                    <option value="">
                      -- None (Mark dishes Sold Out if this item is Out of Stock) --
                    </option>
                    {ingredients
                      .filter((i) => i.id !== editingId)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.productName} ({i.supplier} • {i.supplierCode})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* 14 Major Allergens Interactive Tap Grid */}
              <div>
                <div className="block text-xs font-bold uppercase text-slate-600 mb-2">
                  14 Major Allergens (Pre-selected from text — tap any pill to adjust: No → May Contain → Yes)
                </div>
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
                            ? 'bg-red-600 text-white border-red-700 font-bold shadow-xs'
                            : status === 'May Contain'
                            ? 'bg-amber-400 text-slate-950 border-amber-500 font-bold shadow-xs'
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
                <div className="block text-xs font-bold uppercase text-slate-600 mb-2">
                  Specific Cereal Tracing (Wheat, Barley, Rye, Oats)
                </div>
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
                            ? 'bg-red-600 text-white border-red-700 font-bold shadow-xs'
                            : status === 'May Contain'
                            ? 'bg-amber-400 text-slate-950 border-amber-500 font-bold shadow-xs'
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
                  {isSubmitting ? 'Saving...' : 'Verified & Save Ingredient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
