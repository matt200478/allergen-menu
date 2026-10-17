// src/components/manager/DishBuilder.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Upload,
  Image as ImageIcon,
  Link as LinkIcon,
  X,
  Search,
  ChevronDown,
  UtensilsCrossed,
  Leaf,
  Eye,
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

// Dietary & Lifestyle Badges Configuration for Kiosk & Printable Matrix
export const DIETARY_BADGES = [
  {
    key: 'V',
    short: 'V',
    label: 'Vegetarian',
    activeClass: 'bg-emerald-600 text-white border-emerald-700',
    pillClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
  {
    key: 'VE',
    short: 'VE',
    label: 'Vegan',
    activeClass: 'bg-green-700 text-white border-green-800',
    pillClass: 'bg-green-100 text-green-900 border-green-300',
  },
  {
    key: 'GF',
    short: 'GF',
    label: 'Gluten-Free',
    activeClass: 'bg-amber-500 text-slate-950 border-amber-600',
    pillClass: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  {
    key: 'DF',
    short: 'DF',
    label: 'Dairy-Free',
    activeClass: 'bg-sky-600 text-white border-sky-700',
    pillClass: 'bg-sky-100 text-sky-900 border-sky-300',
  },
  {
    key: 'HALAL',
    short: 'Halal',
    label: 'Halal',
    activeClass: 'bg-teal-700 text-white border-teal-800',
    pillClass: 'bg-teal-100 text-teal-900 border-teal-300',
  },
];

// Wholesaler brand prefixes stripped automatically for Customer-Friendly Kiosk Names
const WHOLESALE_BRAND_PREFIXES = [
  "chef's larder",
  'chefs larder',
  'chef’s larder',
  'brakes',
  'bidfood',
  'booker',
  'country range',
  'everyday favourites',
  'everyday value',
  'sysco',
  'jj foodservice',
  'farmfoods',
  'mccain',
  'lamb weston',
  'aviko',
  'heinz',
  "hellmann's",
  'hellmanns',
];

export const suggestCustomerFriendlyName = (rawKitchenName = '') => {
  if (!rawKitchenName) return '';
  let cleaned = rawKitchenName.trim();

  WHOLESALE_BRAND_PREFIXES.forEach((brand) => {
    const regex = new RegExp(`^${brand}\\s+[-–—:]?\\s*`, 'i');
    cleaned = cleaned.replace(regex, '');
  });

  cleaned = cleaned.replace(
    /\s*\(\s*\d+(\.\d+)?\s*(g|kg|ml|l|oz|pack|pk|pcs|slices|rolls)\s*\)/gi,
    ''
  );

  return cleaned.trim() || rawKitchenName.trim();
};

export const getCustomerFacingIngredientName = (ing) => {
  if (!ing) return '';
  if (ing.customerName && ing.customerName.trim() !== '') {
    return ing.customerName.trim();
  }
  return suggestCustomerFriendlyName(ing.productName || '');
};

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

const ALLERGEN_REGEX = new RegExp(
  `\\b(${ALLERGEN_KEYWORDS.sort((a, b) => b.length - a.length).join('|')})\\b`,
  'gi'
);

export const formatPPDSString = (rawText) => {
  if (!rawText) return { html: '', plainText: '' };

  const plainText = rawText.replace(ALLERGEN_REGEX, (match) => match.toUpperCase());
  const html = rawText.replace(
    ALLERGEN_REGEX,
    (match) => `<strong class="font-extrabold underline">${match.toUpperCase()}</strong>`
  );

  return { html, plainText };
};

const compressImageFile = (file, maxWidth = 800, maxHeight = 600, quality = 0.78) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = () => reject(new Error('Could not decode image file.'));
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
  });
};

// Default fallback categories if none have been saved in Settings yet
export const DEFAULT_CATEGORIES = [
  'Burgers & Hot Dogs',
  'Sharing Platters & Bowling Bites',
  'Pizzas',
  'Kids Soft Play Meals',
  'Sides & Loaded Fries',
  'Desserts & Slushies',
  'Hot & Cold Drinks',
];

/* ============================================================================
 * SEARCHABLE INGREDIENT COMBOBOX SUB-COMPONENT
 * ========================================================================== */
function SearchableIngredientSelect({
  rowIndex,
  selectedId,
  ingredients,
  ingredientMap,
  onSelect,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  const selectedIngredient = ingredientMap[selectedId];

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const suppliers = useMemo(() => {
    const set = new Set(ingredients.map((i) => i.supplier).filter(Boolean));
    return ['ALL', ...Array.from(set)];
  }, [ingredients]);

  const filteredOptions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return ingredients.filter((ing) => {
      const matchesSupplier =
        supplierFilter === 'ALL' || ing.supplier === supplierFilter;
      const matchesQuery =
        !q ||
        ing.productName?.toLowerCase().includes(q) ||
        ing.customerName?.toLowerCase().includes(q) ||
        ing.supplierCode?.toLowerCase().includes(q) ||
        ing.supplier?.toLowerCase().includes(q);
      return matchesSupplier && matchesQuery;
    });
  }, [ingredients, searchTerm, supplierFilter]);

  return (
    <div ref={containerRef} className="relative">
      <button
        id={`ingredient-select-btn-${rowIndex}`}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full px-3 py-2 rounded-lg border text-left text-sm flex items-center justify-between gap-2 bg-white transition ${
          isOpen
            ? 'border-indigo-600 ring-2 ring-indigo-600'
            : 'border-slate-300 hover:border-slate-400'
        }`}
      >
        {selectedIngredient ? (
          <div className="truncate">
            <span className="font-bold text-slate-900">
              {selectedIngredient.inStock === false && (
                <span className="text-red-600 mr-1">[OOS]</span>
              )}
              {selectedIngredient.productName}
            </span>
            <span className="text-xs text-emerald-700 font-semibold ml-1.5">
              [Kiosk: {getCustomerFacingIngredientName(selectedIngredient)}]
            </span>
          </div>
        ) : (
          <span className="text-slate-400 font-medium">
            Search kitchen name, kiosk name, or supplier code...
          </span>
        )}
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute z-40 left-0 right-0 mt-1.5 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="p-2.5 bg-slate-50 border-b border-slate-200 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                ref={searchInputRef}
                id={`ingredient-search-input-${rowIndex}`}
                name={`ingredientSearchInput_${rowIndex}`}
                type="text"
                autoComplete="off"
                placeholder="Type kitchen name, kiosk name, or code (e.g. Chef's Larder, Sausage Roll)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {suppliers.length > 2 && (
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
                {suppliers.map((sup) => (
                  <button
                    key={sup}
                    type="button"
                    onClick={() => setSupplierFilter(sup)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap transition ${
                      supplierFilter === sup
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {sup === 'ALL' ? 'All Suppliers' : sup}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                No ingredients matching &ldquo;{searchTerm}&rdquo;
              </div>
            ) : (
              filteredOptions.map((ing) => {
                const isSelected = ing.id === selectedId;
                const costPer100g =
                  ((Number(ing.costPerPack) || 0) /
                    (Number(ing.packWeightGrams) || 1)) *
                  100;
                const publicName = getCustomerFacingIngredientName(ing);

                return (
                  <button
                    key={ing.id}
                    type="button"
                    onClick={() => {
                      onSelect(ing.id);
                      setIsOpen(false);
                      setSearchTerm('');
                    }}
                    className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-2 transition ${
                      isSelected
                        ? 'bg-indigo-50 text-indigo-950 font-bold'
                        : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate flex items-center gap-1.5">
                        {ing.inStock === false && (
                          <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-black uppercase">
                            OOS
                          </span>
                        )}
                        <span>{ing.productName}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        <span className="text-emerald-700 font-semibold">
                          Kiosk: {publicName}
                        </span>{' '}
                        • {ing.supplier} ({ing.supplierCode}) •{' '}
                        {ing.caloriesPer100g} kcal/100g
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-slate-900">
                        £{Number(ing.costPerPack).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {ing.packWeightGrams}g (£{costPer100g.toFixed(2)}/100g)
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * MAIN DISH BUILDER COMPONENT
 * ========================================================================== */
export default function DishBuilder({ existingDish = null, onSaveSuccess }) {
  const [ingredients, setIngredients] = useState([]);
  const [loadingIngredients, setLoadingIngredients] = useState(true);

  // Dynamic Categories & Financial Settings synced from Firestore 'settings/general'
  const [customCategories, setCustomCategories] = useState(DEFAULT_CATEGORIES);
  const [targetGpSetting, setTargetGpSetting] = useState(70);
  const [vatRateSetting, setVatRateSetting] = useState(20);

  const [dishName, setDishName] = useState(existingDish?.name || '');
  const [category, setCategory] = useState(
    existingDish?.category || DEFAULT_CATEGORIES[0]
  );
  const [photoUrl, setPhotoUrl] = useState(existingDish?.photoUrl || '');
  const [photoMode, setPhotoMode] = useState('UPLOAD');
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [retailPrice, setRetailPrice] = useState(existingDish?.retailPrice || '');
  const [isActive, setIsActive] = useState(existingDish?.isActive ?? true);

  const [dietaryTags, setDietaryTags] = useState(existingDish?.dietaryTags || []);

  const [components, setComponents] = useState(
    existingDish?.components?.map((c) => ({
      ingredientId: c.ingredientId || '',
      qty: c.qty ?? '',
      unitWeightGrams: c.unitWeightGrams ?? '',
      weightGrams: c.weightGrams ?? '',
    })) || [{ ingredientId: '', qty: '', unitWeightGrams: '', weightGrams: '' }]
  );

  const [crossContamAllergens, setCrossContamAllergens] = useState(
    existingDish?.crossContamAllergens || []
  );

  const [includeVatInGp, setIncludeVatInGp] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [copiedPpds, setCopiedPpds] = useState(false);

  const photoInputRef = useRef(null);

  // 1. Real-time Subscription to Ingredients & Venue Settings (Categories, Target GP%, VAT%)
  useEffect(() => {
    const unsubIngredients = onSnapshot(
      collection(db, 'ingredients'),
      (snapshot) => {
        const fetched = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        fetched.sort((a, b) => a.productName.localeCompare(b.productName));
        setIngredients(fetched);
        setLoadingIngredients(false);
      },
      (error) => {
        console.error('Error fetching ingredients:', error);
        setLoadingIngredients(false);
      }
    );

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'general'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.categories) && data.categories.length > 0) {
            setCustomCategories(data.categories);
            // If creating a new dish and current default category was removed in Settings, switch to first valid category
            if (!existingDish?.category) {
              setCategory((prevCat) =>
                data.categories.includes(prevCat) ? prevCat : data.categories[0]
              );
            }
          }
          if (data.targetGpPercentage) {
            setTargetGpSetting(Number(data.targetGpPercentage));
          }
          if (data.vatPercentage !== undefined) {
            setVatRateSetting(Number(data.vatPercentage));
          }
        }
      },
      (err) => {
        console.error('Error syncing settings in DishBuilder:', err);
      }
    );

    return () => {
      unsubIngredients();
      unsubSettings();
    };
  }, [existingDish?.category]);

  // Combine saved Settings categories with the existing dish's category (if it had a legacy category)
  const categoryOptions = useMemo(() => {
    if (
      existingDish?.category &&
      !customCategories.includes(existingDish.category)
    ) {
      return [existingDish.category, ...customCategories];
    }
    return customCategories;
  }, [customCategories, existingDish?.category]);

  const ingredientMap = useMemo(() => {
    const map = {};
    ingredients.forEach((ing) => {
      map[ing.id] = ing;
    });
    return map;
  }, [ingredients]);

  const handlePhotoFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setStatusMessage({
        type: 'error',
        text: 'Please select a valid image file (JPG, PNG, or WebP).',
      });
      return;
    }

    setIsProcessingPhoto(true);
    setStatusMessage(null);
    try {
      const compressedDataUrl = await compressImageFile(file);
      setPhotoUrl(compressedDataUrl);
    } catch (err) {
      console.error('Photo compression error:', err);
      setStatusMessage({
        type: 'error',
        text: 'Could not process that photo. Please try another image.',
      });
    } finally {
      setIsProcessingPhoto(false);
      if (photoInputRef.current) {
        photoInputRef.current.value = '';
      }
    }
  };

  const toggleDietaryTag = (tagKey) => {
    setDietaryTags((prev) =>
      prev.includes(tagKey)
        ? prev.filter((k) => k !== tagKey)
        : [...prev, tagKey]
    );
  };

  const handleAddComponent = () => {
    setComponents((prev) => [
      ...prev,
      { ingredientId: '', qty: '', unitWeightGrams: '', weightGrams: '' },
    ]);
  };

  const handleRemoveComponent = (index) => {
    setComponents((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleComponentChange = (index, field, rawValue) => {
    setComponents((prev) =>
      prev.map((comp, idx) => {
        if (idx !== index) return comp;

        const updated = { ...comp, [field]: rawValue };

        if (field === 'qty' || field === 'unitWeightGrams') {
          const q = parseFloat(field === 'qty' ? rawValue : comp.qty);
          const u = parseFloat(
            field === 'unitWeightGrams' ? rawValue : comp.unitWeightGrams
          );
          if (!Number.isNaN(q) && q > 0 && !Number.isNaN(u) && u > 0) {
            updated.weightGrams = Math.round(q * u * 10) / 10;
          }
        }

        if (field === 'weightGrams') {
          updated.weightGrams = rawValue === '' ? '' : Number(rawValue);
        }

        return updated;
      })
    );
  };

  const toggleCrossContamAllergen = (key) => {
    setCrossContamAllergens((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  // CORE ENGINE: Calories, Cost, GP%, OOS Dependencies, Allergens & Natasha's Law
  const metrics = useMemo(() => {
    let totalCalories = 0;
    let totalCost = 0;
    let totalWeightGrams = 0;
    const outOfStockItems = [];

    const aggregatedAllergens = {};
    UK_ALLERGENS.forEach((a) => {
      aggregatedAllergens[a.key] = 'No';
    });
    GLUTEN_CEREALS.forEach((c) => {
      aggregatedAllergens[c.key] = 'No';
    });

    const mergeAllergenState = (currentVal, incomingVal) => {
      if (currentVal === 'Yes' || incomingVal === 'Yes') return 'Yes';
      if (currentVal === 'May Contain' || incomingVal === 'May Contain')
        return 'May Contain';
      return 'No';
    };

    const validComponents = [];

    components.forEach((comp) => {
      const ing = ingredientMap[comp.ingredientId];
      const weight = parseFloat(comp.weightGrams) || 0;

      if (!ing || weight <= 0) return;

      validComponents.push({ ing, weight });
      totalWeightGrams += weight;

      const componentCalories =
        ((Number(ing.caloriesPer100g) || 0) / 100) * weight;
      totalCalories += componentCalories;

      const packWeight = Number(ing.packWeightGrams) || 1;
      const costPerGram = (Number(ing.costPerPack) || 0) / packWeight;
      totalCost += costPerGram * weight;

      if (ing.inStock === false && !outOfStockItems.includes(ing.productName)) {
        outOfStockItems.push(ing.productName);
      }

      const ingAllergens = ing.allergens || {};
      UK_ALLERGENS.forEach(({ key }) => {
        const val = ingAllergens[key] || 'No';
        aggregatedAllergens[key] = mergeAllergenState(
          aggregatedAllergens[key],
          val
        );
      });

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

    crossContamAllergens.forEach((key) => {
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

    const priceNum = parseFloat(retailPrice) || 0;
    const vatDivisor = 1 + (vatRateSetting || 20) / 100;
    const effectiveRevenue = includeVatInGp ? priceNum / vatDivisor : priceNum;
    const grossProfit = effectiveRevenue - totalCost;
    const gpPercentage =
      effectiveRevenue > 0
        ? ((effectiveRevenue - totalCost) / effectiveRevenue) * 100
        : 0;

    const sortedForPpds = [...validComponents].sort(
      (a, b) => b.weight - a.weight
    );
    let rawCompositeIngredients = sortedForPpds
      .map(({ ing }) => {
        const publicName = getCustomerFacingIngredientName(ing);
        return `${publicName} (${ing.ingredientList || publicName})`;
      })
      .join(', ');

    if (crossContamAllergens.length > 0 && rawCompositeIngredients) {
      const traceLabels = crossContamAllergens.map((key) => {
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

    const dietaryConflicts = [];
    if (dietaryTags.includes('GF') && aggregatedAllergens.gluten !== 'No') {
      dietaryConflicts.push(
        `Tagged "Gluten-Free (GF)", but recipe has Gluten (${aggregatedAllergens.gluten}).`
      );
    }
    if (dietaryTags.includes('DF') && aggregatedAllergens.milk !== 'No') {
      dietaryConflicts.push(
        `Tagged "Dairy-Free (DF)", but recipe has Milk (${aggregatedAllergens.milk}).`
      );
    }
    if (dietaryTags.includes('VE')) {
      const nonVeganAllergens = ['milk', 'eggs', 'fish', 'crustaceans', 'molluscs'].filter(
        (k) => aggregatedAllergens[k] === 'Yes'
      );
      if (nonVeganAllergens.length > 0) {
        dietaryConflicts.push(
          `Tagged "Vegan (VE)", but recipe contains ${nonVeganAllergens.join(', ').toUpperCase()}.`
        );
      }
    }
    if (dietaryTags.includes('V')) {
      const nonVegAllergens = ['fish', 'crustaceans', 'molluscs'].filter(
        (k) => aggregatedAllergens[k] === 'Yes'
      );
      if (nonVegAllergens.length > 0) {
        dietaryConflicts.push(
          `Tagged "Vegetarian (V)", but recipe contains ${nonVegAllergens.join(', ').toUpperCase()}.`
        );
      }
    }

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
      dietaryConflicts,
    };
  }, [
    components,
    ingredientMap,
    retailPrice,
    includeVatInGp,
    vatRateSetting,
    crossContamAllergens,
    dietaryTags,
  ]);

  const handleCopyPpds = () => {
    if (!metrics.ppdsFormatted.plainText) return;
    navigator.clipboard.writeText(
      `INGREDIENTS: ${metrics.ppdsFormatted.plainText}`
    );
    setCopiedPpds(true);
    setTimeout(() => setCopiedPpds(false), 2000);
  };

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

      const dishPayload = {
        name: dishName.trim(),
        category,
        photoUrl: photoUrl.trim() || null,
        retailPrice: parseFloat(retailPrice),
        dietaryTags,
        components: cleanedComponents.map((c) => ({
          ingredientId: c.ingredientId,
          qty: c.qty !== '' ? Number(c.qty) : null,
          unitWeightGrams:
            c.unitWeightGrams !== '' ? Number(c.unitWeightGrams) : null,
          weightGrams: Number(c.weightGrams),
        })),
        crossContamAllergens,
        totalCalories: metrics.totalCalories,
        allergens: metrics.aggregatedAllergens,
        ppdsIngredientText: metrics.ppdsFormatted.plainText,
        hasOutOfStockIngredient: metrics.outOfStockItems.length > 0,
        isActive,
        updatedAt: serverTimestamp(),
      };

      batch.set(dishRef, dishPayload, { merge: true });

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

  const getAllergenBadgeStyle = (status) => {
    if (status === 'Yes') {
      return 'bg-red-600 text-white border-red-700 shadow-sm font-bold';
    }
    if (status === 'May Contain') {
      return 'bg-amber-500 text-slate-950 border-amber-600 font-semibold';
    }
    return 'bg-slate-100 text-slate-400 border-slate-200';
  };

  const getGpColour = (gp) => {
    if (gp >= targetGpSetting)
      return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (gp >= targetGpSetting - 10)
      return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 bg-slate-50 min-h-screen text-slate-900">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
            {existingDish?.id
              ? `Edit Dish: ${existingDish.name}`
              : 'Dish Builder & Margin Calculator'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Build recipes with Qty × Unit Weight calculation, dietary badges, live GP%, and brand-free customer PPDS labels.
          </p>
        </div>

        <label
          htmlFor="dish-active-toggle"
          className="inline-flex items-center gap-3 cursor-pointer bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm"
        >
          <input
            id="dish-active-toggle"
            name="dishActiveToggle"
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

      {/* Dietary Badge Conflict Guard Banner */}
      {metrics.dietaryConflicts.length > 0 && (
        <div className="mt-6 p-4 rounded-xl bg-amber-50 border-2 border-amber-500 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-amber-950 uppercase tracking-wide">
              Dietary Badge &amp; Allergen Conflict Warning
            </h3>
            <ul className="text-xs font-semibold text-amber-900 mt-1 list-disc list-inside space-y-0.5">
              {metrics.dietaryConflicts.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
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
          {/* Card 1: Dish Metadata, Dietary Badges & Photo Upload */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">
              1. Dish Details, Dietary Badges &amp; Photo
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="dish-name"
                  className="block text-xs font-bold uppercase text-slate-600 mb-1"
                >
                  Dish Name *
                </label>
                <input
                  id="dish-name"
                  name="dishName"
                  type="text"
                  required
                  placeholder="e.g., Double Bacon Strike Burger"
                  value={dishName}
                  onChange={(e) => setDishName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 text-sm font-medium"
                />
              </div>

              <div>
                <label
                  htmlFor="dish-category"
                  className="block text-xs font-bold uppercase text-slate-600 mb-1"
                >
                  Menu Category (Synced from Settings) *
                </label>
                <select
                  id="dish-category"
                  name="dishCategory"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 text-sm font-medium bg-white"
                >
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="dish-retail-price"
                  className="block text-xs font-bold uppercase text-slate-600 mb-1"
                >
                  Retail Selling Price (£) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold">
                    £
                  </span>
                  <input
                    id="dish-retail-price"
                    name="dishRetailPrice"
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

              {/* Dietary & Lifestyle Kiosk Badges Selector */}
              <div className="sm:col-span-2 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-600 mb-2">
                  <Leaf className="w-4 h-4 text-emerald-600" />
                  Dietary &amp; Lifestyle Kiosk Badges (1-Tap Customer Filters)
                </div>
                <div className="flex flex-wrap gap-2">
                  {DIETARY_BADGES.map((badge) => {
                    const isSelected = dietaryTags.includes(badge.key);
                    return (
                      <button
                        key={badge.key}
                        type="button"
                        onClick={() => toggleDietaryTag(badge.key)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 ${
                          isSelected
                            ? `${badge.activeClass} shadow-xs`
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <span className="px-1.5 py-0.5 rounded bg-black/15 text-[10px] font-black">
                          {badge.short}
                        </span>
                        <span>{badge.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dish Photo Upload / Web Link Section */}
              <div className="sm:col-span-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="block text-xs font-bold uppercase text-slate-600">
                    Dish Photo (Optional — Shown on Customer Kiosk)
                  </span>
                  <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setPhotoMode('UPLOAD')}
                      className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition ${
                        photoMode === 'UPLOAD'
                          ? 'bg-white text-indigo-600 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Upload className="w-3 h-3" />
                      Upload / Camera
                    </button>
                    <button
                      type="button"
                      onClick={() => setPhotoMode('URL')}
                      className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition ${
                        photoMode === 'URL'
                          ? 'bg-white text-indigo-600 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <LinkIcon className="w-3 h-3" />
                      Paste Link
                    </button>
                  </div>
                </div>

                <input
                  id="dish-photo-upload"
                  name="dishPhotoUpload"
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoFileChange}
                  className="hidden"
                />

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  {photoUrl ? (
                    <div className="relative w-28 h-24 rounded-xl overflow-hidden border border-slate-300 bg-slate-100 shrink-0 shadow-2xs">
                      <img
                        src={photoUrl}
                        alt="Dish preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setPhotoUrl('')}
                        className="absolute top-1 right-1 p-1 rounded-full bg-slate-900/80 text-white hover:bg-red-600 transition"
                        title="Remove Photo"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-28 h-24 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-slate-400 shrink-0">
                      <ImageIcon className="w-6 h-6 mb-1" />
                      <span className="text-[10px] font-semibold">No Photo</span>
                    </div>
                  )}

                  <div className="flex-1 w-full">
                    {photoMode === 'UPLOAD' ? (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          disabled={isProcessingPhoto}
                          onClick={() => photoInputRef.current?.click()}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold transition disabled:opacity-50"
                        >
                          <Upload className="w-4 h-4" />
                          {isProcessingPhoto
                            ? 'Optimising Photo...'
                            : photoUrl
                            ? 'Replace Dish Photo'
                            : 'Choose Photo or Take Picture'}
                        </button>
                        <p className="text-[11px] text-slate-500">
                          Automatically resized &amp; optimised (800px JPEG) for instant Kiosk loading.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <input
                          id="dish-photo-url"
                          name="dishPhotoUrl"
                          type="url"
                          placeholder="https://example.com/burger.jpg"
                          value={photoUrl.startsWith('data:') ? '' : photoUrl}
                          onChange={(e) => setPhotoUrl(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-600 text-sm"
                        />
                        <p className="text-[11px] text-slate-500">
                          Paste a direct image URL (or switch to Upload / Camera above).
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Searchable Recipe Components with Inline Qty × Unit Weight Calculator */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  2. Recipe Components &amp; Portion Multiplier
                </h2>
                <p className="text-xs text-slate-500">
                  Kitchen staff see full supplier names here; customers only see the clean <strong>Kiosk Name</strong> on the menu.
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
                    ? Math.round(
                        ((selectedIng.caloriesPer100g || 0) / 100) * weight
                      )
                    : 0;
                  const rowCost = selectedIng
                    ? ((selectedIng.costPerPack || 0) /
                        (selectedIng.packWeightGrams || 1)) *
                      weight
                    : 0;
                  const isOos = selectedIng?.inStock === false;

                  return (
                    <div
                      key={index}
                      className={`p-3.5 rounded-xl border transition space-y-3 ${
                        isOos
                          ? 'bg-red-50/70 border-red-300'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex-1">
                          <div className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                            Ingredient #{index + 1}{' '}
                            {isOos && (
                              <span className="text-red-600">(OUT OF STOCK)</span>
                            )}
                          </div>
                          <SearchableIngredientSelect
                            rowIndex={index}
                            selectedId={comp.ingredientId}
                            ingredients={ingredients}
                            ingredientMap={ingredientMap}
                            onSelect={(newId) =>
                              handleComponentChange(index, 'ingredientId', newId)
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-4 shrink-0">
                          <div className="text-right bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                            <div className="text-xs font-extrabold text-slate-900">
                              £{rowCost.toFixed(2)}
                            </div>
                            <div className="text-[10px] font-semibold text-orange-700">
                              {rowCalories} kcal
                            </div>
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

                      {/* Bottom Row: Inline Portion Multiplier Calculator (Qty × Unit g = Total g) */}
                      <div className="grid grid-cols-12 gap-2 items-center pt-2 border-t border-slate-200/80">
                        <div className="col-span-3 sm:col-span-3">
                          <label
                            htmlFor={`comp-qty-${index}`}
                            className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5"
                          >
                            Qty (Opt)
                          </label>
                          <input
                            id={`comp-qty-${index}`}
                            name={`compQty_${index}`}
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder="e.g. 3"
                            value={comp.qty}
                            onChange={(e) =>
                              handleComponentChange(index, 'qty', e.target.value)
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>

                        <div className="col-span-1 text-center pt-4 text-xs font-black text-slate-400">
                          ×
                        </div>

                        <div className="col-span-3 sm:col-span-3">
                          <label
                            htmlFor={`comp-unit-weight-${index}`}
                            className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5"
                          >
                            Unit (g)
                          </label>
                          <input
                            id={`comp-unit-weight-${index}`}
                            name={`compUnitWeight_${index}`}
                            type="number"
                            min="0"
                            step="0.1"
                            placeholder="e.g. 45"
                            value={comp.unitWeightGrams}
                            onChange={(e) =>
                              handleComponentChange(
                                index,
                                'unitWeightGrams',
                                e.target.value
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>

                        <div className="col-span-1 text-center pt-4 text-xs font-black text-slate-400">
                          =
                        </div>

                        <div className="col-span-4 sm:col-span-4">
                          <label
                            htmlFor={`portion-weight-${index}`}
                            className="block text-[10px] font-extrabold uppercase text-indigo-700 mb-0.5"
                          >
                            Total Portion (g) *
                          </label>
                          <input
                            id={`portion-weight-${index}`}
                            name={`portionWeight_${index}`}
                            type="number"
                            min="0.1"
                            step="0.1"
                            required
                            placeholder="e.g. 135"
                            value={comp.weightGrams}
                            onChange={(e) =>
                              handleComponentChange(
                                index,
                                'weightGrams',
                                e.target.value
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border-2 border-indigo-300 bg-white text-xs font-extrabold text-slate-900 focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Shared Fryer / Kitchen Cross-Contamination Bar */}
            <div className="pt-4 border-t border-slate-200 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-amber-800">
                <UtensilsCrossed className="w-4 h-4 text-amber-600" />
                Shared Fryer / Prep Surface Traces (Optional &ldquo;May Contain&rdquo; Override)
              </div>
              <p className="text-[11px] text-slate-500">
                If this dish is cooked in a shared fryer or grill, tap any allergens handled in that equipment to automatically add a &ldquo;May Contain&rdquo; trace warning:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {UK_ALLERGENS.map((a) => {
                  const isSelected = crossContamAllergens.includes(a.key);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => toggleCrossContamAllergen(a.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                        isSelected
                          ? 'bg-amber-400 text-slate-950 border-amber-500 shadow-2xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {isSelected ? `+ ${a.label} (Trace)` : a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Card 3: Natasha's Law (PPDS) Label Generator */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-indigo-600" />
                <div>
                  <h2 className="text-lg font-bold text-slate-800">
                    3. Natasha&apos;s Law (PPDS) &amp; Customer Kiosk Preview
                  </h2>
                  <p className="text-xs text-slate-500">
                    Uses your clean <strong>Customer-Friendly Names</strong> (supplier brands hidden) ordered by weight descending.
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
              <div className="font-bold uppercase text-slate-700 mb-1 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-emerald-700" />
                <span>
                  Customer Kiosk View: {dishName || 'Untitled Dish'} (
                  {metrics.totalWeightGrams}g | {metrics.totalCalories} kcal)
                </span>
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
                Live Margin &amp; Nutrition
              </h2>

              <label
                htmlFor="deduct-vat-toggle"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer"
              >
                <input
                  id="deduct-vat-toggle"
                  name="deductVatToggle"
                  type="checkbox"
                  checked={includeVatInGp}
                  onChange={(e) => setIncludeVatInGp(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Deduct {vatRateSetting}% VAT
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
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

              <div
                className={`p-3.5 rounded-xl border ${getGpColour(
                  metrics.gpPercentage
                )}`}
              >
                <div className="text-xs font-bold uppercase opacity-80">
                  Gross Profit (Target: {targetGpSetting}%)
                </div>
                <div className="text-2xl font-extrabold mt-1">
                  {metrics.gpPercentage.toFixed(1)}%
                </div>
                <div className="text-[11px] opacity-80 mt-0.5">
                  {includeVatInGp
                    ? `Net (ex. ${vatRateSetting}% VAT)`
                    : 'Gross Retail Basis'}
                </div>
              </div>

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
                Automatically computed from selected ingredients and shared fryer traces.
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
            disabled={isSaving || isProcessingPhoto}
            className="w-full py-3.5 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-extrabold text-base shadow-md hover:shadow-lg transition flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            {isSaving
              ? 'Saving Dish & Recording Audit Log...'
              : existingDish?.id
              ? 'Update Dish & Log Audit Trail'
              : 'Save Dish to Menu'}
          </button>
        </div>
      </form>
    </div>
  );
}
