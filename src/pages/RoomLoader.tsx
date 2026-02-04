// src/pages/RoomLoader.tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { DateTime } from 'luxon';
import {
  searchRoomLoaders,
  getRoomLoader,
  searchItems,
  submitReminderFeedback,
  checkItemPricing,
  saveRoomLoaderForm,
  type RoomLoader,
  type RoomLoaderSearchParams,
  type SentStatus,
  type DueStatus,
  type Appointment,
  type Patient,
  type Client,
  type ReminderWithPrice,
  type SearchableItem,
} from '../api/roomLoader';
import { http } from '../api/http';
import { KeyValue } from '../components/KeyValue';
import { evetPatientLink, evetClientLink } from '../utils/evet';

export default function RoomLoaderPage() {
  const [roomLoaders, setRoomLoaders] = useState<RoomLoader[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoomLoader, setSelectedRoomLoader] = useState<RoomLoader | null>(null);
  const [selectedRoomLoaderId, setSelectedRoomLoaderId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filters, setFilters] = useState<RoomLoaderSearchParams>({
    activeOnly: true,
  });
  // Search filter for table (doctor or client name)
  const [tableSearch, setTableSearch] = useState<string>('');
  // Store answers to questions for each pet
  const [petAnswers, setPetAnswers] = useState<Record<number, { mobility: boolean | null; labWork: boolean | null }>>({});
  // Store added items for each pet (items added via search)
  const [addedItems, setAddedItems] = useState<Record<number, SearchableItem[]>>({});
  // Store removed reminder IDs (reminders that have been removed by the user)
  const [removedReminders, setRemovedReminders] = useState<Set<number>>(new Set());
  // Reminder IDs that have had "Confirm match" clicked (required before Send to Client)
  const [confirmedMatchReminders, setConfirmedMatchReminders] = useState<Set<number>>(new Set());
  // Confirmation modal state for removing reminders
  const [reminderToRemove, setReminderToRemove] = useState<{ id: number; description: string } | null>(null);
  // Search state
  const [searchQuery, setSearchQuery] = useState<Record<number, string>>({});
  const [searchResults, setSearchResults] = useState<Record<number, SearchableItem[]>>({});
  const [searchLoading, setSearchLoading] = useState<Record<number, boolean>>({});

  // Load room loaders
  useEffect(() => {
    loadRoomLoaders();
  }, [filters]);

  // Load selected room loader details
  useEffect(() => {
    if (selectedRoomLoaderId) {
      loadRoomLoaderDetails(selectedRoomLoaderId);
      setIsModalOpen(true);
    } else {
      setSelectedRoomLoader(null);
      setIsModalOpen(false);
    }
  }, [selectedRoomLoaderId]);

  // Debounce search for each pet
  // Use a ref to track previous search queries to avoid unnecessary re-renders
  const prevPetSearchQueriesRef = useRef<Record<number, string>>({});
  
  useEffect(() => {
    if (!selectedRoomLoader) return;

    const timeouts: Record<number, NodeJS.Timeout> = {};
    const currentQueries: Record<number, string> = {};

    Object.keys(searchQuery).forEach((petIdStr) => {
      const petId = Number(petIdStr);
      const query = searchQuery[petId] || '';
      currentQueries[petId] = query;
      const prevQuery = prevPetSearchQueriesRef.current[petId] || '';

      // Only proceed if query actually changed
      if (query === prevQuery) {
        return;
      }

      // Clear existing timeout for this pet
      if (timeouts[petId]) {
        clearTimeout(timeouts[petId]);
      }

      if (query && query.trim().length >= 2) {
        timeouts[petId] = setTimeout(async () => {
          if (!selectedRoomLoader?.practice?.id) return;
          // Check if query still matches (might have changed)
          if (searchQuery[petId] !== query) {
            return;
          }
          setSearchLoading((prev) => ({ ...prev, [petId]: true }));
          try {
            const results = await searchItems({
              q: query,
              practiceId: selectedRoomLoader.practice.id,
              limit: 50,
            });
            // Check again before setting results
            if (searchQuery[petId] === query) {
              setSearchResults((prev) => ({ ...prev, [petId]: results }));
            }
          } catch (err: any) {
            console.error('Error searching items:', err);
            if (searchQuery[petId] === query) {
              setSearchResults((prev) => ({ ...prev, [petId]: [] }));
            }
          } finally {
            if (searchQuery[petId] === query) {
              setSearchLoading((prev) => ({ ...prev, [petId]: false }));
            }
          }
        }, 300);
      } else {
        setSearchResults((prev) => ({ ...prev, [petId]: [] }));
      }
    });

    // Update ref with current queries
    prevPetSearchQueriesRef.current = currentQueries;

    return () => {
      Object.values(timeouts).forEach((timeout) => clearTimeout(timeout));
    };
  }, [searchQuery, selectedRoomLoader]);


  async function loadRoomLoaders() {
    setLoading(true);
    setError(null);
    try {
      const data = await searchRoomLoaders(filters);
      setRoomLoaders(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load room loaders');
      console.error('Error loading room loaders:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadRoomLoaderDetails(id: number) {
    try {
      const data = await getRoomLoader(id);
      setSelectedRoomLoader(data);
      
      // Check if saved form data exists and restore it
      if (data?.savedForm) {
        const savedForm = data.savedForm;
        
        // Restore added items
        if (savedForm.addedItems) {
          const restoredAddedItems: Record<number, SearchableItem[]> = {};
          Object.keys(savedForm.addedItems).forEach((petIdStr) => {
            const petId = Number(petIdStr);
            restoredAddedItems[petId] = savedForm.addedItems[petId] || [];
          });
          setAddedItems(restoredAddedItems);
        }
        
        // Restore quantities
        if (savedForm.reminderQuantities) {
          setReminderQuantities(savedForm.reminderQuantities);
        }
        if (savedForm.addedItemQuantities) {
          setAddedItemQuantities(savedForm.addedItemQuantities);
        }
        
        // Restore text fields
        if (savedForm.appointmentReasons) {
          setAppointmentReasons(savedForm.appointmentReasons);
        }
        if (savedForm.arrivalWindows) {
          setArrivalWindows(savedForm.arrivalWindows);
        }
        
        // Restore answers
        if (savedForm.petAnswers) {
          setPetAnswers(savedForm.petAnswers);
        }
        
        // Restore vaccine checkboxes
        if (savedForm.vaccineCheckboxes) {
          setVaccineCheckboxes(savedForm.vaccineCheckboxes);
        }
        
        // Restore reminder corrections
        if (savedForm.reminderCorrections) {
          setReminderCorrections(savedForm.reminderCorrections);
        }
        
        // Restore removed reminders
        if (savedForm.removedReminders && Array.isArray(savedForm.removedReminders)) {
          setRemovedReminders(new Set(savedForm.removedReminders));
        }
        
        // Restore confirmed match reminders
        if (savedForm.confirmedMatchReminders && Array.isArray(savedForm.confirmedMatchReminders)) {
          setConfirmedMatchReminders(new Set(savedForm.confirmedMatchReminders));
        }
        
        // Note: reminders are already loaded from the API (they come from savedForm.reminders automatically)
        // Initialize quantities for reminders if not already set
        if (data?.reminders && Array.isArray(data.reminders)) {
          setReminderQuantities((prev) => {
            const updated = { ...prev };
            data.reminders!.forEach((reminder) => {
              if (reminder.reminder?.id && !(reminder.reminder.id in updated)) {
                updated[reminder.reminder.id] = 1;
              }
            });
            return updated;
          });
        }
      } else {
        // No saved form - initialize with defaults
        setConfirmedMatchReminders(new Set());
        setReminderValidationErrorIds(new Set());
        // Initialize quantities to 1 for all reminders (preserve existing quantities if any)
        if (data?.reminders && Array.isArray(data.reminders)) {
          setReminderQuantities((prev) => {
            const updated = { ...prev };
            data.reminders!.forEach((reminder) => {
              if (reminder.reminder?.id && !(reminder.reminder.id in updated)) {
                updated[reminder.reminder.id] = 1;
              }
            });
            return updated;
          });
        }
        
        // Initialize vaccine checkboxes based on declinedInventoryItems
        if (data?.patients && Array.isArray(data.patients)) {
          setVaccineCheckboxes((prev) => {
            const updated = { ...prev };
            
            data.patients!.forEach((patient) => {
              if (patient.id && !(patient.id in updated)) {
                // Default all to checked
                const initial = {
                  felv: true,
                  lepto: true,
                  lyme: true,
                  bordatella: true,
                  sharps: true, // Will be set based on vaccine selections
                };
                
                // Check declined items for THIS specific patient (declined items are nested under each patient)
                const declinedItems = patient.declinedInventoryItems || [];
                
                // Check if any declined items match vaccine names
                declinedItems.forEach((declinedItem: any) => {
                  // Handle both structures: direct name or nested inventoryItem.name
                  const name = ((declinedItem.inventoryItem?.name || declinedItem.name) || '').toLowerCase();
                  // String matching for each checkbox - check for various name variations
                  if (name.includes('felv') || name.includes('feline leukemia') || name.includes('feline leukemia virus')) {
                    initial.felv = false;
                  }
                  if (name.includes('lepto') || name.includes('leptospirosis')) {
                    initial.lepto = false;
                  }
                  if (name.includes('lyme') || name.includes('lyme disease')) {
                    initial.lyme = false;
                  }
                  if (name.includes('bordatella') || name.includes('bordetella') || name.includes('kennel cough')) {
                    initial.bordatella = false;
                  }
                });
                
                // Sharps is checked if any vaccine is checked
                initial.sharps = initial.felv || initial.lepto || initial.lyme || initial.bordatella;
                
                updated[patient.id] = initial;
              }
            });
            return updated;
          });
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load room loader details');
      console.error('Error loading room loader details:', err);
    }
  }

  // Process room loaders for table display
  // Each room loader shows as one line with all appointments combined
  const tableRows = useMemo(() => {
    const rows: Array<{
      roomLoaderId: number;
      apptDate: string | null;
      bookedDate: string | null;
      doctor: string;
      clientName: string;
      pets: string[];
      sentStatus: SentStatus;
      dueStatus: DueStatus | null;
      roomLoader: RoomLoader;
    }> = [];

    roomLoaders.forEach((rl) => {
      // Collect all unique pets from appointments and room loader patients
      const patientIds = new Set<number>();
      const pets: string[] = [];
      
      // Get pets from appointments first
      rl.appointments.forEach((apt) => {
        if (apt.patient?.id && !patientIds.has(apt.patient.id)) {
          patientIds.add(apt.patient.id);
          pets.push(apt.patient.name || 'Unknown Pet');
        }
      });

      // Add any additional patients from room loader that aren't in appointments
      rl.patients.forEach((p) => {
        if (p.id && !patientIds.has(p.id)) {
          patientIds.add(p.id);
          pets.push(p.name || 'Unknown Pet');
        }
      });

      // Get appointment date (use earliest appointment date if multiple)
      let apptDate: string | null = null;
      if (rl.appointments.length > 0) {
        const dates = rl.appointments
          .map((apt) => apt.appointmentStart)
          .filter((d): d is string => !!d)
          .sort();
        if (dates.length > 0) {
          apptDate = DateTime.fromISO(dates[0]).toFormat('yyyy-MM-dd');
        }
      }

      // Get booked date (externally created) - use earliest if multiple
      let bookedDate: string | null = null;
      if (rl.appointments.length > 0) {
        const bookedDates = rl.appointments
          .map((apt) => {
            // Prefer externalCreated if available, then bookedDate, then created if externallyCreated is true
            return apt.externalCreated || apt.bookedDate || (apt.externallyCreated ? apt.created : null);
          })
          .filter((d): d is string => !!d)
          .sort();
        if (bookedDates.length > 0) {
          bookedDate = DateTime.fromISO(bookedDates[0]).toFormat('yyyy-MM-dd');
        }
      }

      // Get doctor name - if multiple appointments with different doctors, show first one or "Multiple"
      let doctor: string = 'N/A';
      if (rl.appointments.length > 0) {
        const doctors = new Set<string>();
        rl.appointments.forEach((apt) => {
          if (apt.primaryProvider) {
            const doctorName = `${apt.primaryProvider.firstName || ''} ${apt.primaryProvider.lastName || ''}`.trim();
            if (doctorName) {
              doctors.add(doctorName);
            }
          }
        });
        if (doctors.size === 1) {
          doctor = Array.from(doctors)[0];
        } else if (doctors.size > 1) {
          doctor = 'Multiple';
        }
      }

      // Get client name - use first appointment's client or first patient's client
      let clientName = 'Unknown Client';
      if (rl.appointments.length > 0 && rl.appointments[0].client) {
        const client = rl.appointments[0].client;
        clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Unknown Client';
      } else if (rl.patients.length > 0 && rl.patients[0].clients && rl.patients[0].clients.length > 0) {
        const client = rl.patients[0].clients[0];
        clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Unknown Client';
      }

      rows.push({
        roomLoaderId: rl.id,
        apptDate,
        bookedDate,
        doctor,
        clientName,
        pets,
        sentStatus: rl.sentStatus,
        dueStatus: rl.dueStatus,
        roomLoader: rl,
      });
    });

    // Sort by appointment date (soonest first), then by room loader ID
    return rows.sort((a, b) => {
      if (a.apptDate && b.apptDate) {
        return a.apptDate.localeCompare(b.apptDate);
      }
      if (a.apptDate) return -1;
      if (b.apptDate) return 1;
      return a.roomLoaderId - b.roomLoaderId;
    });
  }, [roomLoaders]);

  // Filter table rows based on search query (doctor or client name)
  const filteredTableRows = useMemo(() => {
    if (!tableSearch.trim()) {
      return tableRows;
    }
    const searchLower = tableSearch.toLowerCase().trim();
    return tableRows.filter((row) => {
      const doctorMatch = row.doctor.toLowerCase().includes(searchLower);
      const clientMatch = row.clientName.toLowerCase().includes(searchLower);
      return doctorMatch || clientMatch;
    });
  }, [tableRows, tableSearch]);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return 'N/A';
    try {
      return DateTime.fromISO(dateStr).toFormat('MMM dd, yyyy');
    } catch {
      return dateStr;
    }
  }

  function formatDateTime(dateStr: string | null): string {
    if (!dateStr) return 'N/A';
    try {
      return DateTime.fromISO(dateStr).toFormat('MMM dd, yyyy hh:mm a');
    } catch {
      return dateStr;
    }
  }

  function handleRowClick(roomLoaderId: number) {
    setSelectedRoomLoaderId(roomLoaderId);
  }

  function handleCloseModal() {
    setIsModalOpen(false);
    setSelectedRoomLoaderId(null);
    setSelectedRoomLoader(null);
    setPetAnswers({});
    setAddedItems({});
    setSearchQuery({});
    setSearchResults({});
    setSearchLoading({});
    setReminderFeedback({});
    setReminderCorrections({});
    setReminderQuantities({});
    setAddedItemQuantities({});
    setAppointmentReasons({});
    setVaccineCheckboxes({});
  }

  function handleQuantityChange(reminderId: number, quantity: number) {
    // Ensure quantity is at least 1
    const validQuantity = Math.max(1, Math.floor(quantity) || 1);
    setReminderQuantities((prev) => ({
      ...prev,
      [reminderId]: validQuantity,
    }));
  }

  function handleAddedItemQuantityChange(petId: number, itemIdx: number, quantity: number) {
    // Ensure quantity is at least 1
    const validQuantity = Math.max(1, Math.floor(quantity) || 1);
    const key = `${petId}-${itemIdx}`;
    setAddedItemQuantities((prev) => ({
      ...prev,
      [key]: validQuantity,
    }));
  }

  function handleRemoveReminder(reminderId: number, reminderDescription: string) {
    // Show confirmation modal
    setReminderToRemove({ id: reminderId, description: reminderDescription });
  }

  function confirmRemoveReminder() {
    if (!reminderToRemove) return;
    
    const reminderId = reminderToRemove.id;
    setRemovedReminders((prev) => {
      const newSet = new Set(prev);
      newSet.add(reminderId);
      return newSet;
    });
    setConfirmedMatchReminders((prev) => {
      const next = new Set(prev);
      next.delete(reminderId);
      return next;
    });
    setReminderValidationErrorIds((prev) => {
      const next = new Set(prev);
      next.delete(reminderId);
      return next;
    });
    
    // Also clean up related state
    const feedbackKey = `reminder-${reminderId}`;
    setReminderFeedback((prev) => {
      const newFeedback = { ...prev };
      delete newFeedback[feedbackKey];
      return newFeedback;
    });
    setReminderCorrections((prev) => {
      const newCorrections = { ...prev };
      delete newCorrections[feedbackKey];
      return newCorrections;
    });
    setReminderQuantities((prev) => {
      const newQuantities = { ...prev };
      delete newQuantities[reminderId];
      return newQuantities;
    });
    
    // Close modal
    setReminderToRemove(null);
  }

  function cancelRemoveReminder() {
    setReminderToRemove(null);
  }

  // Helper function to get tiered price for a given quantity
  function getTieredPrice(tieredPricing: any, quantity: number, basePrice: number): number {
    if (!tieredPricing?.hasTieredPricing || !tieredPricing.priceBreaks || tieredPricing.priceBreaks.length === 0) {
      return basePrice;
    }

    // Find the price break that matches the quantity
    const qty = Math.floor(quantity);
    for (const priceBreak of tieredPricing.priceBreaks) {
      if (!priceBreak.isActive) continue;
      
      const lowQty = parseInt(priceBreak.lowQuantity, 10);
      const highQty = parseInt(priceBreak.highQuantity, 10);
      
      if (qty >= lowQty && qty <= highQty) {
        return Number(priceBreak.price);
      }
    }

    // If no match found, use the highest tier or base price
    const activeBreaks = tieredPricing.priceBreaks.filter((pb: any) => pb.isActive);
    if (activeBreaks.length > 0) {
      // Use the highest tier for quantities beyond the max
      const highestTier = activeBreaks.reduce((max: any, pb: any) => {
        const maxHigh = parseInt(max.highQuantity, 10);
        const pbHigh = parseInt(pb.highQuantity, 10);
        return pbHigh > maxHigh ? pb : max;
      });
      return Number(highestTier.price);
    }

    return basePrice;
  }

  async function handleSearchItems(petId: number, query: string) {
    if (!query.trim() || !selectedRoomLoader?.practice?.id) {
      setSearchResults((prev) => ({ ...prev, [petId]: [] }));
      return;
    }

    setSearchLoading((prev) => ({ ...prev, [petId]: true }));
    try {
      const results = await searchItems({
        q: query,
        practiceId: selectedRoomLoader.practice.id,
        limit: 50,
      });
      setSearchResults((prev) => ({ ...prev, [petId]: results }));
    } catch (err: any) {
      console.error('Error searching items:', err);
      setSearchResults((prev) => ({ ...prev, [petId]: [] }));
    } finally {
      setSearchLoading((prev) => ({ ...prev, [petId]: false }));
    }
  }

  async function handleAddItem(petId: number, item: SearchableItem) {
    if (!selectedRoomLoader?.practice?.id) {
      console.error('Cannot add item: practice ID not available');
      return;
    }

    // Find the patient and client from petsWithAppointments
    const patientData = petsWithAppointments.find((p) => p.patient.id === petId);
    if (!patientData?.client?.id) {
      console.error('Cannot add item: client ID not available');
      return;
    }

    // First, add the item with the original price
    const itemWithOriginalPrice = { ...item };
    setAddedItems((prev) => ({
      ...prev,
      [petId]: [...(prev[petId] || []), itemWithOriginalPrice],
    }));

    // Clear search
    setSearchQuery((prev) => ({ ...prev, [petId]: '' }));
    setSearchResults((prev) => ({ ...prev, [petId]: [] }));

    // Check pricing for the item
    try {
      // Construct the item object based on itemType
      const itemPayload: any = {};
      if (item.itemType === 'lab' && item.lab) {
        itemPayload.lab = {
          id: item.lab.id || 0,
          name: item.name,
          price: String(item.price || 0),
          code: item.code || '',
        };
      } else if (item.itemType === 'procedure' && (item as any).procedure) {
        itemPayload.procedure = {
          id: (item as any).procedure.id || 0,
          name: item.name,
          price: String(item.price || 0),
          code: item.code || '',
        };
      } else if (item.itemType === 'inventory' && item.inventoryItem) {
        itemPayload.inventoryItem = {
          id: item.inventoryItem.id || 0,
          name: item.name,
          price: String(item.price || 0),
          code: item.code || '',
        };
      } else {
        // Fallback: try to extract ID from the item object
        const itemId = (item.lab?.id || (item as any).procedure?.id || item.inventoryItem?.id || 0);
        if (item.itemType === 'lab') {
          itemPayload.lab = {
            id: itemId,
            name: item.name,
            price: String(item.price || 0),
            code: item.code || '',
          };
        } else if (item.itemType === 'procedure') {
          itemPayload.procedure = {
            id: itemId,
            name: item.name,
            price: String(item.price || 0),
            code: item.code || '',
          };
        } else if (item.itemType === 'inventory') {
          itemPayload.inventoryItem = {
            id: itemId,
            name: item.name,
            price: String(item.price || 0),
            code: item.code || '',
          };
        }
      }

      const pricingResponse = await checkItemPricing({
        patientId: petId,
        practiceId: selectedRoomLoader.practice.id,
        clientId: patientData.client.id,
        itemType: item.itemType,
        item: itemPayload,
      });

      // Update the item with the adjusted price and wellness plan info
      setAddedItems((prev) => {
        const items = prev[petId] || [];
        const itemIndex = items.findIndex((i, idx) => {
          // Find the last added item (the one we just added)
          return idx === items.length - 1 && i.name === item.name;
        });
        
        if (itemIndex !== -1) {
          const updatedItems = [...items];
          updatedItems[itemIndex] = {
            ...updatedItems[itemIndex],
            price: pricingResponse.adjustedPrice,
            originalPrice: pricingResponse.originalPrice,
            wellnessPlanPricing: pricingResponse.wellnessPlanPricing,
            discountPricing: pricingResponse.discountPricing,
            tieredPricing: pricingResponse.tieredPricing,
          };
          return {
            ...prev,
            [petId]: updatedItems,
          };
        }
        return prev;
      });
    } catch (err: any) {
      console.error('Error checking item pricing:', err);
      // Item was already added with original price, so we just log the error
    }
  }

  function handleRemoveAddedItem(petId: number, index: number) {
    setAddedItems((prev) => {
      const items = prev[petId] || [];
      const newItems = items.filter((_, i) => i !== index);
      
      // Clean up quantities for removed items and reindex remaining items
      setAddedItemQuantities((prevQty) => {
        const newQty: Record<string, number> = {};
        Object.keys(prevQty).forEach((key) => {
          const [keyPetId, keyIdx] = key.split('-').map(Number);
          if (keyPetId === petId) {
            if (keyIdx < index) {
              // Keep quantities for items before the removed one
              newQty[key] = prevQty[key];
            } else if (keyIdx > index) {
              // Reindex quantities for items after the removed one
              newQty[`${petId}-${keyIdx - 1}`] = prevQty[key];
            }
            // Skip the removed item's quantity
          } else {
            // Keep quantities for other pets
            newQty[key] = prevQty[key];
          }
        });
        return newQty;
      });
      
      return {
        ...prev,
        [petId]: newItems,
      };
    });
  }

  // Reminder feedback state
  const [reminderFeedback, setReminderFeedback] = useState<Record<string, 'correct' | 'incorrect' | 'correcting' | null>>({});
  const [reminderCorrections, setReminderCorrections] = useState<Record<string, { searchQuery: string; results: SearchableItem[]; loading: boolean; selectedItem: SearchableItem | null; patientId?: number; scopeChosen?: boolean }>>({});
  // Store quantities for each reminder (keyed by reminderId)
  const [reminderQuantities, setReminderQuantities] = useState<Record<number, number>>({});
  // Store quantities for each added item (keyed by `${petId}-${itemIdx}`)
  const [addedItemQuantities, setAddedItemQuantities] = useState<Record<string, number>>({});
  // Store edited reason for appointment for each patient (keyed by patient.id)
  const [appointmentReasons, setAppointmentReasons] = useState<Record<number, string>>({});
  // Store edited arrival window for each patient (keyed by patient.id)
  const [arrivalWindows, setArrivalWindows] = useState<Record<number, string>>({});
  // Store checkbox states for each patient (keyed by patient.id)
  const [vaccineCheckboxes, setVaccineCheckboxes] = useState<Record<number, { felv: boolean; lepto: boolean; lyme: boolean; bordatella: boolean; sharps: boolean }>>({});
  
  // Loading state for sending to client
  const [sendingToClient, setSendingToClient] = useState(false);
  // Loading state for saving form
  const [savingForm, setSavingForm] = useState(false);
  // Inline validation errors when Send to Client fails (per patient: reason, mobility, labWork)
  const [sendValidationErrors, setSendValidationErrors] = useState<Record<number, { reason?: boolean; mobility?: boolean; labWork?: boolean }>>({});
  // Reminder IDs that still need "Confirm match" (or match + confirm, or remove) before Send to Client
  const [reminderValidationErrorIds, setReminderValidationErrorIds] = useState<Set<number>>(new Set());

  async function handleReminderFeedback(
    reminderId: number,
    reminderText: string,
    isCorrect: boolean,
    reminderWithPrice?: ReminderWithPrice,
    correctItem?: SearchableItem,
    patientId?: number
  ) {
    if (!selectedRoomLoader?.practice?.id) return;

    const key = `reminder-${reminderId}`;
    setReminderFeedback((prev) => ({ ...prev, [key]: isCorrect ? 'correct' : 'correcting' }));

    try {
      let itemId: number | undefined;
      let itemType: 'lab' | 'procedure' | 'inventory' | undefined;

      if (isCorrect && reminderWithPrice && reminderWithPrice.matchedItem) {
        // When marking as correct for a reminder that already has a match, use the matched item from the reminder
        itemId = reminderWithPrice.matchedItem.id;
        // Normalize itemType to lowercase and validate
        const normalizedType = reminderWithPrice.itemType?.toLowerCase();
        if (normalizedType === 'lab' || normalizedType === 'procedure' || normalizedType === 'inventory') {
          itemType = normalizedType as 'lab' | 'procedure' | 'inventory';
        }
      } else if (correctItem) {
        // When correcting or submitting a match for an unmatched reminder, extract from the selected correct item
        if (correctItem.inventoryItem?.id) {
          itemId = correctItem.inventoryItem.id;
          itemType = 'inventory';
        } else if (correctItem.lab?.id) {
          itemId = correctItem.lab.id;
          itemType = 'lab';
        } else if ((correctItem as any).procedure?.id) {
          itemId = (correctItem as any).procedure.id;
          itemType = 'procedure';
        }
      }

      // Validate that itemType and itemId are provided when isCorrect is true
      if (isCorrect && (!itemType || !itemId)) {
        throw new Error('Item type and item ID are required when marking as correct. The reminder may not have a matched item.');
      }

      // Build the request payload
      const requestPayload: any = {
        reminderText,
        reminderId,
        practiceId: selectedRoomLoader.practice.id,
        isCorrect,
        notes: isCorrect 
          ? (reminderWithPrice?.matchedItem ? 'Confirmed correct match' : 'Submitted match for unmatched reminder')
          : correctItem 
            ? 'Corrected match' 
            : 'Marked as incorrect',
      };

      // Add patientId if provided (for patient-specific mapping)
      if (patientId) {
        requestPayload.patientId = patientId;
      }

      if (isCorrect) {
        // When confirming as correct, use itemType and itemId
        requestPayload.itemType = itemType;
        requestPayload.itemId = itemId;
      } else if (correctItem) {
        // When correcting an incorrect match, use correctItemType, correctItemId, and incorrectItemName
        requestPayload.correctItemType = itemType;
        requestPayload.correctItemId = itemId;
        // Get the incorrect item name from the original matched item
        if (reminderWithPrice?.matchedItem?.name) {
          requestPayload.incorrectItemName = reminderWithPrice.matchedItem.name;
        }
      }

      await submitReminderFeedback(requestPayload);

      setReminderFeedback((prev) => ({ ...prev, [key]: isCorrect ? 'correct' : 'incorrect' }));
      if (correctItem) {
        setReminderCorrections((prev) => ({ ...prev, [key]: { ...prev[key], selectedItem: correctItem } }));
      }
    } catch (err: any) {
      console.error('Error submitting reminder feedback:', err);
      setReminderFeedback((prev) => ({ ...prev, [key]: null }));
      alert('Failed to submit feedback. Please try again.');
    }
  }

  async function handleSearchReminderCorrection(reminderId: number, query: string) {
    if (!selectedRoomLoader?.practice?.id || !query.trim()) return;

    const key = `reminder-${reminderId}`;
    setReminderCorrections((prev) => ({
      ...prev,
      [key]: { ...prev[key], searchQuery: query, loading: true },
    }));

    try {
      const results = await searchItems({
        q: query,
        practiceId: selectedRoomLoader.practice.id,
        limit: 50,
      });
      setReminderCorrections((prev) => ({
        ...prev,
        [key]: { ...prev[key], results, loading: false },
      }));
    } catch (err: any) {
      console.error('Error searching correction items:', err);
      setReminderCorrections((prev) => ({
        ...prev,
        [key]: { ...prev[key], results: [], loading: false },
      }));
    }
  }

  function handleSelectCorrection(reminderId: number, item: SearchableItem) {
    const key = `reminder-${reminderId}`;
    setReminderCorrections((prev) => ({
      ...prev,
      [key]: { ...prev[key], selectedItem: item },
    }));
  }

  function handleSubmitCorrection(reminderId: number, reminderText: string, item: SearchableItem, reminderWithPrice?: ReminderWithPrice, patientId?: number) {
    return handleReminderFeedback(reminderId, reminderText, false, reminderWithPrice, item, patientId);
  }


  // Debounce search for reminder corrections (unmatched reminders)
  // Use a ref to track previous search queries to avoid unnecessary re-renders
  const prevSearchQueriesRef = useRef<Record<string, string>>({});
  
  useEffect(() => {
    if (!selectedRoomLoader) return;

    const timeouts: Record<string, NodeJS.Timeout> = {};
    const currentQueries: Record<string, string> = {};

    Object.keys(reminderCorrections).forEach((key) => {
      const correction = reminderCorrections[key];
      const query = correction?.searchQuery || '';
      currentQueries[key] = query;
      const prevQuery = prevSearchQueriesRef.current[key] || '';

      // Only proceed if query actually changed
      if (query === prevQuery) {
        return;
      }

      // Clear existing timeout for this reminder
      if (timeouts[key]) {
        clearTimeout(timeouts[key]);
      }

      // Only search if query is at least 2 characters and we don't have a selected item
      if (query && query.trim().length >= 2 && !correction?.selectedItem) {
        timeouts[key] = setTimeout(async () => {
          if (!selectedRoomLoader?.practice?.id) return;
          const reminderId = Number(key.replace('reminder-', ''));
          if (isNaN(reminderId)) return;

          // Check again if query still exists and no item is selected (state might have changed)
          setReminderCorrections((prev) => {
            const current = prev[key];
            // Don't update if item was selected or query was cleared/changed
            if (current?.selectedItem || !current?.searchQuery || current.searchQuery !== query) {
              return prev;
            }
            return {
              ...prev,
              [key]: { ...current, loading: true },
            };
          });

          try {
            const results = await searchItems({
              q: query,
              practiceId: selectedRoomLoader.practice.id,
              limit: 50,
            });
            setReminderCorrections((prev) => {
              const current = prev[key];
              // Don't update if item was selected or query was cleared/changed
              if (current?.selectedItem || !current?.searchQuery || current.searchQuery !== query) {
                return prev;
              }
              return {
                ...prev,
                [key]: { ...current, results, loading: false },
              };
            });
          } catch (err: any) {
            console.error('Error searching correction items:', err);
            setReminderCorrections((prev) => {
              const current = prev[key];
              if (current?.selectedItem || !current?.searchQuery || current.searchQuery !== query) {
                return prev;
              }
              return {
                ...prev,
                [key]: { ...current, results: [], loading: false },
              };
            });
          }
        }, 300);
      } else if (!query || query.trim().length < 2) {
        // Only clear results if query is empty and no item is selected
        if (!correction?.selectedItem) {
          setReminderCorrections((prev) => ({
            ...prev,
            [key]: { ...prev[key], results: [], loading: false },
          }));
        }
      }
    });

    // Update ref with current queries
    prevSearchQueriesRef.current = currentQueries;

    return () => {
      Object.values(timeouts).forEach((timeout) => clearTimeout(timeout));
    };
  }, [reminderCorrections, selectedRoomLoader]);

  function handleAnswerChange(petId: number, question: 'mobility' | 'labWork', value: boolean) {
    setPetAnswers((prev) => ({
      ...prev,
      [petId]: {
        ...prev[petId],
        [question]: value,
      },
    }));
    setSendValidationErrors((prev) => {
      if (!prev[petId]) return prev;
      const next = { ...prev };
      const { [question]: _removed, ...rest } = next[petId] as { reason?: boolean; mobility?: boolean; labWork?: boolean };
      if (Object.keys(rest).length === 0) delete next[petId];
      else next[petId] = rest;
      return next;
    });
  }

  // Package all data for sending to client
  function packageDataForClient(): any {
    if (!selectedRoomLoader) return null;

    const patientData = petsWithAppointments.map((item) => {
      const { patient, appointments, reminders, client } = item;
      const firstAppt = appointments[0];
      
      // Calculate window of arrival (if not FIXED)
      let arrivalWindow: { start: string; end: string } | null = null;
      if (firstAppt) {
        const appointmentTypeName = firstAppt.appointmentType?.name?.toUpperCase() || firstAppt.appointmentType?.prettyName?.toUpperCase() || '';
        const isFixed = appointmentTypeName === 'FIXED';
        
        if (!isFixed) {
          const startTime = DateTime.fromISO(firstAppt.appointmentStart);
          const windowStart = startTime.minus({ hours: 1 });
          const windowEnd = startTime.plus({ hours: 1 });
          arrivalWindow = {
            start: windowStart.toISO() || '',
            end: windowEnd.toISO() || '',
          };
        }
      }

      // Get reminders with quantities and corrections
      const reminderItems = (reminders || []).map((reminderWithPrice) => {
        const reminderId = reminderWithPrice.reminder.id;
        const correctionKey = `reminder-${reminderId}`;
        const correction = reminderCorrections[correctionKey];
        const quantity = reminderQuantities[reminderId] || 1;
        
        // Determine the final matched item (either original match or correction)
        let finalItem: any = null;
        if (correction?.selectedItem) {
          // Use corrected item
          finalItem = {
            id: correction.selectedItem.inventoryItem?.id || correction.selectedItem.lab?.id || (correction.selectedItem as any).procedure?.id,
            type: correction.selectedItem.itemType,
            name: correction.selectedItem.name,
            code: correction.selectedItem.code,
            price: correction.selectedItem.price != null ? Number(correction.selectedItem.price) : null,
          };
        } else if (reminderWithPrice.matchedItem) {
          // Use original matched item
          finalItem = {
            id: reminderWithPrice.matchedItem.id,
            type: reminderWithPrice.itemType,
            name: reminderWithPrice.matchedItem.name,
            code: reminderWithPrice.matchedItem.code,
            price: reminderWithPrice.price != null ? Number(reminderWithPrice.price) : null,
          };
        }

        return {
          reminderId: reminderId,
          reminderText: reminderWithPrice.reminder.description,
          reminderType: reminderWithPrice.reminder.reminderType,
          dueDate: reminderWithPrice.reminder.dueDate,
          quantity: quantity,
          item: finalItem,
          confidence: reminderWithPrice.confidence,
        };
      });

      // Get added items
      const addedItemsList = (addedItems[patient.id] || []).map((item) => ({
        id: item.inventoryItem?.id || item.lab?.id || (item as any).procedure?.id,
        type: item.itemType,
        name: item.name,
        code: item.code,
        price: item.price != null ? Number(item.price) : null,
        quantity: 1, // Added items default to quantity 1
      }));

      // Get answers
      const answers = petAnswers[patient.id] || { mobility: null, labWork: null };

      // Get vaccine checkboxes
      const vaccines = vaccineCheckboxes[patient.id] || { felv: true, lepto: true, lyme: true, bordatella: true, sharps: true };

      return {
        patientId: patient.id,
        patientName: patient.name,
        clientId: client?.id || null,
        clientName: client ? `${client.firstName} ${client.lastName}`.trim() : null,
        appointmentIds: appointments.map((apt) => apt.id),
        appointmentReason: appointmentReasons[patient.id] || '',
        originalAppointmentReason: firstAppt?.description || firstAppt?.instructions || '',
        arrivalWindow: arrivalWindow,
        questions: {
          mobility: answers.mobility,
          labWork: answers.labWork,
        },
        reminders: reminderItems,
        addedItems: addedItemsList,
        vaccines: {
          felv: vaccines.felv,
          lepto: vaccines.lepto,
          lyme: vaccines.lyme,
          bordatella: vaccines.bordatella,
          sharps: vaccines.sharps,
        },
      };
    });

    // Return payload in the new structure: { roomLoaderId, formData }
    return {
      roomLoaderId: selectedRoomLoader.id,
      formData: {
        practiceId: selectedRoomLoader.practice.id,
        practiceName: selectedRoomLoader.practice.name,
        sentStatus: selectedRoomLoader.sentStatus,
        dueStatus: selectedRoomLoader.dueStatus,
        patients: patientData,
      },
    };
  }

  // Handle sending to client
  async function handleSendToClient() {
    if (!selectedRoomLoader) return;

    // Validate required fields before sending; build inline error state per patient
    const errors: Record<number, { reason?: boolean; mobility?: boolean; labWork?: boolean }> = {};
    let hasErrors = false;
    petsWithAppointments.forEach((item) => {
      const pid = item.patient.id;
      const patientErrors: { reason?: boolean; mobility?: boolean; labWork?: boolean } = {};
      if (!(appointmentReasons[pid] || '').trim()) {
        patientErrors.reason = true;
        hasErrors = true;
      }
      const answers = petAnswers[pid] || { mobility: null, labWork: null };
      if (answers.mobility === null) {
        patientErrors.mobility = true;
        hasErrors = true;
      }
      if (answers.labWork === null) {
        patientErrors.labWork = true;
        hasErrors = true;
      }
      if (Object.keys(patientErrors).length > 0) {
        errors[pid] = patientErrors;
      }
    });
    if (hasErrors) {
      setSendValidationErrors(errors);
      return;
    }

    // Validate reminders: every displayed reminder must have a match and be confirmed (or be removed)
    const reminderErrorIds = new Set<number>();
    petsWithAppointments.forEach((item) => {
      (item.reminders || []).forEach((reminderWithPrice) => {
        const reminderId = reminderWithPrice.reminder.id;
        if (!reminderId || removedReminders.has(reminderId)) return;
        const correction = reminderCorrections[`reminder-${reminderId}`];
        const hasMatch = !!(reminderWithPrice.matchedItem?.name || correction?.selectedItem);
        const isConfirmed = confirmedMatchReminders.has(reminderId);
        if (!hasMatch || !isConfirmed) {
          reminderErrorIds.add(reminderId);
        }
      });
    });
    if (reminderErrorIds.size > 0) {
      setReminderValidationErrorIds(reminderErrorIds);
      return;
    }

    setSendValidationErrors({});
    setReminderValidationErrorIds(new Set());
    setSendingToClient(true);
    try {
      const payload = packageDataForClient();
      
      if (!payload) {
        alert('Error: Unable to package data. Please try again.');
        return;
      }

      await http.post('/room-loader/send-to-client', payload);
      
      // Show success message
      alert('Successfully sent to client!');
      
      // Refresh the room loader data to get updated sent status
      await loadRoomLoaders();
      
      // Reload the selected room loader details to reflect changes
      if (selectedRoomLoaderId) {
        await loadRoomLoaderDetails(selectedRoomLoaderId);
      }
      
    } catch (error: any) {
      console.error('Error sending to client:', error);
      alert(`Failed to send to client: ${error?.message || 'Please try again.'}`);
    } finally {
      setSendingToClient(false);
    }
  }

  async function handleSaveForLater() {
    if (!selectedRoomLoader) return;

    setSavingForm(true);
    try {
      // Collect reminders from current state, filtering out removed reminders
      const remindersToSave: ReminderWithPrice[] = [];
      
      if (selectedRoomLoader.reminders) {
        selectedRoomLoader.reminders.forEach((reminderWithPrice) => {
          const reminderId = reminderWithPrice.reminder.id;
          // Only include reminders that haven't been removed
          if (reminderId && !removedReminders.has(reminderId)) {
            // Use the reminder as-is since it already has the full ReminderWithPrice structure
            remindersToSave.push(reminderWithPrice);
          }
        });
      }

      // Collect all form state
      const formDataToSave: any = {
        reminders: remindersToSave,
        // Save added items (manually added items)
        addedItems: Object.keys(addedItems).reduce((acc, petIdStr) => {
          const petId = Number(petIdStr);
          acc[petId] = addedItems[petId] || [];
          return acc;
        }, {} as Record<number, SearchableItem[]>),
        // Save quantities
        reminderQuantities: reminderQuantities,
        addedItemQuantities: addedItemQuantities,
        // Save text fields
        appointmentReasons: appointmentReasons,
        arrivalWindows: arrivalWindows,
        // Save answers
        petAnswers: petAnswers,
        // Save vaccine checkboxes
        vaccineCheckboxes: vaccineCheckboxes,
        // Save reminder corrections
        reminderCorrections: reminderCorrections,
        // Save removed reminders (so we know which ones to exclude when loading)
        removedReminders: Array.from(removedReminders),
        // Save confirmed match reminders
        confirmedMatchReminders: Array.from(confirmedMatchReminders),
      };

      await saveRoomLoaderForm({
        roomLoaderId: selectedRoomLoader.id,
        formData: formDataToSave,
      });

      // Show success message
      alert('Form saved successfully!');

      // Refresh the room loader data
      await loadRoomLoaders();

      // Reload the selected room loader details to reflect changes
      if (selectedRoomLoaderId) {
        await loadRoomLoaderDetails(selectedRoomLoaderId);
      }
    } catch (error: any) {
      console.error('Error saving form:', error);
      alert(`Failed to save form: ${error?.message || 'Please try again.'}`);
    } finally {
      setSavingForm(false);
    }
  }

  // Group appointments by patient for display
  const petsWithAppointments = useMemo(() => {
    if (!selectedRoomLoader) return [];

    const petMap = new Map<number, { patient: Patient; appointments: Appointment[]; reminders: ReminderWithPrice[]; client: Client | null }>();

    // First, add all patients from the room loader
    selectedRoomLoader.patients.forEach((patient) => {
      const firstClient = patient.clients?.[0];
      const client: Client | null = firstClient
        ? {
            id: firstClient.id,
            isActive: true,
            isDeleted: false,
            pimsId: (firstClient as any).pimsId || null,
            pimsType: (firstClient as any).pimsType,
            firstName: firstClient.firstName || '',
            lastName: firstClient.lastName || '',
            email: firstClient.email || null,
            phone1: firstClient.phone1 || null,
            alerts: (firstClient as any).alerts || null,
          }
        : null;
      petMap.set(patient.id, {
        patient,
        appointments: [],
        reminders: [],
        client,
      });
    });

    // Then, add appointments and associate them with patients
    selectedRoomLoader.appointments.forEach((apt) => {
      if (apt.patient?.id) {
        const existing = petMap.get(apt.patient.id);
        if (existing) {
          existing.appointments.push(apt);
          // Use appointment client if available and patient doesn't have one, or update if appointment client has more info (like pimsId)
          if (apt.client) {
            if (!existing.client) {
              existing.client = apt.client;
            } else {
              // Update client with appointment client data (especially pimsId and alerts)
              existing.client = { ...existing.client, ...apt.client };
            }
          }
          // Update patient data from appointment if it has more complete info
          if (apt.patient) {
            existing.patient = { ...existing.patient, ...apt.patient };
          }
        } else {
          // Patient not in room loader patients, but has appointment
          const aptClient = apt.client || apt.patient.clients?.[0];
          const client: Client | null = aptClient
            ? {
                id: aptClient.id,
                isActive: true,
                isDeleted: false,
                pimsId: (aptClient as any).pimsId || null,
                pimsType: (aptClient as any).pimsType,
                firstName: aptClient.firstName || '',
                lastName: aptClient.lastName || '',
                email: aptClient.email || null,
                phone1: aptClient.phone1 || null,
                alerts: (aptClient as any).alerts || null,
              }
            : null;
          petMap.set(apt.patient.id, {
            patient: apt.patient,
            appointments: [apt],
            reminders: [],
            client,
          });
        }
      }
    });

    // Add reminders - match them to patients by patient ID
    if (selectedRoomLoader.reminders) {
      selectedRoomLoader.reminders.forEach((reminderWithPrice) => {
        const patientId = reminderWithPrice.reminder.patient?.id;
        if (patientId) {
          const existing = petMap.get(patientId);
          if (existing) {
            existing.reminders.push(reminderWithPrice);
          } else {
            // Patient not in map yet, add them
            petMap.set(patientId, {
              patient: reminderWithPrice.reminder.patient as Patient,
              appointments: [],
              reminders: [reminderWithPrice],
              client: null,
            });
          }
        }
      });
    }

    return Array.from(petMap.values());
  }, [selectedRoomLoader]);

  return (
    <div style={{ padding: '20px' }}>
      <h1>Room Loader</h1>

      {/* Filters */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search Box */}
        <div style={{ flex: '1 1 300px', minWidth: '250px' }}>
          <input
            type="text"
            placeholder="Search by doctor or client name..."
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '14px',
              border: '1px solid #ced4da',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <label>
          <input
            type="checkbox"
            checked={filters.activeOnly ?? true}
            onChange={(e) => setFilters({ ...filters, activeOnly: e.target.checked })}
          />
          {' '}Active Only
        </label>
        <label>
          Sent Status:
          <select
            value={filters.sentStatus || ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                sentStatus: e.target.value ? (e.target.value as SentStatus) : undefined,
              })
            }
            style={{ marginLeft: '5px' }}
          >
            <option value="">All</option>
            <option value="not_sent">Not Sent</option>
            <option value="sent_1">Sent 1</option>
            <option value="sent_2">Sent 2</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label>
          Due Status:
          <select
            value={filters.dueStatus || ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                dueStatus: e.target.value ? (e.target.value as DueStatus) : undefined,
              })
            }
            style={{ marginLeft: '5px' }}
          >
            <option value="">All</option>
            <option value="due">Due</option>
            <option value="past_due">Past Due</option>
            <option value="upcoming">Upcoming</option>
            <option value="10_days_before">10 Days Before</option>
            <option value="6_days_before">6 Days Before</option>
            <option value="10_days_past_due">10 Days Past Due</option>
          </select>
        </label>
        <button onClick={loadRoomLoaders} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px', backgroundColor: '#fee', color: '#c00', marginBottom: '20px' }}>
          Error: {error}
        </div>
      )}

      {/* Table */}
      <div
        style={{
          marginBottom: '30px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '580px', // Header (~50px) + ~10 rows (~48px each) = ~530px, rounded up
        }}
      >
        <div style={{ overflowX: 'auto', flexShrink: 0 }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '14px',
              backgroundColor: '#fff',
            }}
          >
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>
                  Appt Date
                </th>
                <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>
                  Booked Date
                </th>
                <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>
                  Appt Doctor
                </th>
                <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>
                  Client Name
                </th>
                <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>
                  Pets
                </th>
                <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>
                  Sent Status
                </th>
                <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>
                  Due Status
                </th>
              </tr>
            </thead>
          </table>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'auto',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '14px',
              backgroundColor: '#fff',
            }}
          >
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <tbody>
              {loading && filteredTableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '20px', textAlign: 'center' }}>
                    Loading...
                  </td>
                </tr>
              ) : filteredTableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                    {tableSearch.trim() ? 'No room loaders match your search' : 'No room loaders found'}
                  </td>
                </tr>
              ) : (
                filteredTableRows.map((row, idx) => (
                  <tr
                    key={`${row.roomLoaderId}-${idx}`}
                    onClick={() => handleRowClick(row.roomLoaderId)}
                    style={{
                      cursor: 'pointer',
                      backgroundColor: selectedRoomLoaderId === row.roomLoaderId ? '#e3f2fd' : 'transparent',
                      borderBottom: '1px solid #ddd',
                    }}
                    onMouseEnter={(e) => {
                      if (selectedRoomLoaderId !== row.roomLoaderId) {
                        e.currentTarget.style.backgroundColor = '#f5f5f5';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedRoomLoaderId !== row.roomLoaderId) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                      {row.apptDate ? formatDate(row.apptDate) : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                      {row.bookedDate ? formatDate(row.bookedDate) : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', border: '1px solid #ddd' }}>{row.doctor}</td>
                    <td style={{ padding: '12px', border: '1px solid #ddd' }}>{row.clientName}</td>
                    <td style={{ padding: '12px', border: '1px solid #ddd' }}>{row.pets.join(', ')}</td>
                    <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          backgroundColor:
                            row.sentStatus === 'completed'
                              ? '#4caf50'
                              : row.sentStatus === 'sent_2'
                                ? '#2196f3'
                                : row.sentStatus === 'sent_1'
                                  ? '#ff9800'
                                  : '#9e9e9e',
                          color: '#fff',
                        }}
                      >
                        {row.sentStatus.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                      </span>
                    </td>
                    <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                      {row.dueStatus ? (
                        <span
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            backgroundColor:
                              row.dueStatus === 'past_due' || row.dueStatus === '10_days_past_due'
                                ? '#f44336'
                                : row.dueStatus === 'due'
                                  ? '#ff9800'
                                  : '#4caf50',
                            color: '#fff',
                          }}
                        >
                          {row.dueStatus.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                        </span>
                      ) : (
                        'N/A'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Room Loader Details Modal */}
      {isModalOpen && selectedRoomLoader && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={handleCloseModal}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1000px, 95vw)',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: '24px',
              borderRadius: '12px',
              background: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Room Loader Details</h2>
              <button
                onClick={handleCloseModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#666',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            <div
              style={{
                padding: '20px',
                backgroundColor: '#f9f9f9',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            >
          {/* Pet-by-Pet Information */}
          {petsWithAppointments.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
              No pets found in this room loader
            </div>
          ) : (
            petsWithAppointments.map((item, petIndex) => {
              const { patient, appointments, client } = item;
              const petAnswersForPet = petAnswers[patient.id] || { mobility: null, labWork: null };
              const firstAppt = appointments[0];
              
              // Use patient data from appointment if available and more complete
              const displayPatient = firstAppt?.patient && firstAppt.patient.id === patient.id 
                ? { ...patient, ...firstAppt.patient } 
                : patient;

            return (
              <div
                key={patient.id}
                style={{
                  marginBottom: '30px',
                  padding: '20px',
                  backgroundColor: '#fff',
                  border: '2px solid #ddd',
                  borderRadius: '8px',
                }}
              >
                <div
                  style={{
                    marginBottom: '25px',
                    paddingBottom: '15px',
                    borderBottom: '3px solid #e0e0e0',
                  }}
                >
                  <h3 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>
                    Pet {petIndex + 1}:{' '}
                    {displayPatient.pimsId ? (
                      <a
                        href={evetPatientLink(displayPatient.pimsId)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#212529', textDecoration: 'underline', cursor: 'pointer' }}
                      >
                        {displayPatient.name || 'Unknown Pet'}
                      </a>
                    ) : (
                      displayPatient.name || 'Unknown Pet'
                    )}
                    {(() => {
                      const details = [];
                      // Calculate age from DOB
                      if (displayPatient.dob) {
                        try {
                          const dob = DateTime.fromISO(displayPatient.dob);
                          const now = DateTime.now();
                          const ageYears = Math.floor(now.diff(dob, 'years').years);
                          const ageMonths = Math.floor(now.diff(dob, 'months').months % 12);
                          if (ageYears > 0) {
                            details.push(ageMonths > 0 ? `${ageYears}y ${ageMonths}m` : `${ageYears}y`);
                          } else if (ageMonths > 0) {
                            details.push(`${ageMonths}m`);
                          } else {
                            const ageDays = Math.floor(now.diff(dob, 'days').days);
                            details.push(`${ageDays}d`);
                          }
                        } catch (e) {
                          // If date parsing fails, skip age
                        }
                      }
                      if (displayPatient.sex) details.push(displayPatient.sex);
                      if (displayPatient.breed) details.push(displayPatient.breed);
                      if (displayPatient.weight) details.push(`${displayPatient.weight} lbs`);
                      if (details.length > 0) {
                        return <span style={{ fontSize: '18px', fontWeight: 400, color: '#666', marginLeft: '10px' }}>({details.join(', ')})</span>;
                      }
                      return null;
                    })()}
                  </h3>
                </div>

                {/* Patient Alerts */}
                {displayPatient.alerts && (
                  <div style={{ marginBottom: '15px', padding: '8px', backgroundColor: '#fff3cd', borderRadius: '4px', border: '1px solid #ffc107' }}>
                    <strong style={{ color: '#856404' }}>Patient Alerts:</strong>
                    <div style={{ marginTop: '4px', color: '#856404' }}>{displayPatient.alerts}</div>
                  </div>
                )}

                {/* Client Name */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ marginBottom: '10px', color: '#555' }}>Client Name</h4>
                  <div style={{ padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd' }}>
                    {client ? (
                      <div>
                        <strong>
                          {client.pimsId ? (
                            <a
                              href={evetClientLink(String(client.pimsId))}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: '#212529', textDecoration: 'underline', cursor: 'pointer' }}
                            >
                              {client.firstName} {client.lastName}
                            </a>
                          ) : (
                            <span>{client.firstName} {client.lastName}</span>
                          )}
                        </strong>
                        {client.email && <div style={{ marginTop: '5px', color: '#666' }}>Email: {client.email}</div>}
                        {client.phone1 && <div style={{ color: '#666' }}>Phone: {client.phone1}</div>}
                        {client.alerts && (
                          <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#fff3cd', borderRadius: '4px', border: '1px solid #ffc107' }}>
                            <strong style={{ color: '#856404' }}>Alerts:</strong>
                            <div style={{ marginTop: '4px', color: '#856404' }}>{client.alerts}</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ color: '#999' }}>No client information available</div>
                    )}
                  </div>
                </div>

                {/* Appointment Information */}
                {firstAppt && (
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ marginBottom: '10px', color: '#555' }}>Appointment Information</h4>
                    <div style={{ padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd' }}>
                      {(() => {
                        const startTime = DateTime.fromISO(firstAppt.appointmentStart);
                        const endTime = DateTime.fromISO(firstAppt.appointmentEnd);
                        const dateStr = startTime.toFormat('MMM dd, yyyy');
                        const startTimeStr = startTime.toFormat('h:mma');
                        const endTimeStr = endTime.toFormat('h:mma');
                        return `${dateStr} Scheduled Time: ${startTimeStr}-${endTimeStr}`;
                      })()}
                    </div>
                  </div>
                )}

                {/* Window of Arrival */}
                {firstAppt && (() => {
                  // Check if appointment type is FIXED (case-insensitive)
                  const appointmentTypeName = firstAppt.appointmentType?.name?.toUpperCase() || firstAppt.appointmentType?.prettyName?.toUpperCase() || '';
                  const isFixed = appointmentTypeName === 'FIXED';
                  
                  if (isFixed) {
                    // No arrival window for FIXED appointments
                    return null;
                  }
                  
                  // Calculate default window of arrival (one hour before and one hour after start time)
                  const startTime = DateTime.fromISO(firstAppt.appointmentStart);
                  const windowStart = startTime.minus({ hours: 1 });
                  const windowEnd = startTime.plus({ hours: 1 });
                  const defaultWindow = `${windowStart.toFormat('h:mma')} - ${windowEnd.toFormat('h:mma')}`;
                  
                  // Use stored value or default
                  const arrivalWindowValue = arrivalWindows[patient.id] || defaultWindow;
                  
                  return (
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={{ marginBottom: '10px', color: '#555' }}>Window of Arrival</h4>
                      <div style={{ flex: 1 }}>
                        <textarea
                          value={arrivalWindowValue}
                          onChange={(e) => {
                            setArrivalWindows((prev) => ({
                              ...prev,
                              [patient.id]: e.target.value,
                            }));
                          }}
                          placeholder="Enter arrival window..."
                          style={{
                            width: '100%',
                            minHeight: '60px',
                            padding: '12px',
                            fontSize: '14px',
                            border: '1px solid #ced4da',
                            borderRadius: '4px',
                            fontFamily: 'inherit',
                            resize: 'vertical',
                          }}
                        />
                      </div>
                    </div>
                  );
                })()}

                {/* Reason for Appointment */}
                {firstAppt && (
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ marginBottom: '10px', color: '#555' }}>Reason for Appointment (required)</h4>
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                      {/* Editable text box */}
                      <div style={{ flex: 1 }}>
                        <textarea
                          value={appointmentReasons[patient.id] || ''}
                          onChange={(e) => {
                            setAppointmentReasons((prev) => ({
                              ...prev,
                              [patient.id]: e.target.value,
                            }));
                            setSendValidationErrors((prev) => {
                              const next = { ...prev };
                              if (next[patient.id]) {
                                const { reason, ...rest } = next[patient.id] as { reason?: boolean; mobility?: boolean; labWork?: boolean };
                                if (Object.keys(rest).length === 0) delete next[patient.id];
                                else next[patient.id] = rest;
                              }
                              return next;
                            });
                          }}
                          placeholder="Enter reason for appointment..."
                          style={{
                            width: '100%',
                            minHeight: '80px',
                            padding: '12px',
                            fontSize: '14px',
                            border: sendValidationErrors[patient.id]?.reason ? '1px solid #dc3545' : '1px solid #ced4da',
                            borderRadius: '4px',
                            fontFamily: 'inherit',
                            resize: 'vertical',
                            boxSizing: 'border-box',
                          }}
                        />
                        {sendValidationErrors[patient.id]?.reason && (
                          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#dc3545' }}>Reason for Appointment is required</p>
                        )}
                      </div>
                      {/* Original appointment reason for reference */}
                      <div style={{ flex: 1, padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd', minHeight: '80px' }}>
                        <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: 500 }}>
                          Original Appointment Reason:
                        </div>
                        <div style={{ fontSize: '14px', color: '#333', whiteSpace: 'pre-wrap' }}>
                          {firstAppt.description || firstAppt.instructions || 'No notes provided'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Questions */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ marginBottom: '15px', color: '#555', fontSize: '18px', fontWeight: 600 }}>Questions</h4>

                  {/* Mobility Question */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 500, color: '#333', fontSize: '16px' }}>
                      Does this issue have anything to do with mobility? (required)
                    </label>
                    <div style={{ display: 'flex', gap: '20px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`mobility-${patient.id}`}
                          checked={petAnswersForPet.mobility === true}
                          onChange={() => handleAnswerChange(patient.id, 'mobility', true)}
                          style={{ marginRight: '8px', cursor: 'pointer' }}
                        />
                        Yes
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`mobility-${patient.id}`}
                          checked={petAnswersForPet.mobility === false}
                          onChange={() => handleAnswerChange(patient.id, 'mobility', false)}
                          style={{ marginRight: '8px', cursor: 'pointer' }}
                        />
                        No
                      </label>
                    </div>
                    {sendValidationErrors[patient.id]?.mobility && (
                      <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#dc3545' }}>Please answer Yes or No</p>
                    )}
                  </div>

                  {/* Lab Work Question */}
                  <div>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 500, color: '#333', fontSize: '16px' }}>
                      Would lab work help to diagnose the issue? Examples include PU/PD, lethargy, ADR, vomiting, weight loss (required)
                    </label>
                    <div style={{ display: 'flex', gap: '20px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`labWork-${patient.id}`}
                          checked={petAnswersForPet.labWork === true}
                          onChange={() => handleAnswerChange(patient.id, 'labWork', true)}
                          style={{ marginRight: '8px', cursor: 'pointer' }}
                        />
                        Yes
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`labWork-${patient.id}`}
                          checked={petAnswersForPet.labWork === false}
                          onChange={() => handleAnswerChange(patient.id, 'labWork', false)}
                          style={{ marginRight: '8px', cursor: 'pointer' }}
                        />
                        No
                      </label>
                    </div>
                    {sendValidationErrors[patient.id]?.labWork && (
                      <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#dc3545' }}>Please answer Yes or No</p>
                    )}
                  </div>
                </div>

                {/* Reminders */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ marginBottom: '15px', color: '#555' }}>
                    Reminders ({item.reminders?.filter((r) => {
                      const id = r.reminder.id;
                      return id && !removedReminders.has(id);
                    }).length || 0} + {addedItems[patient.id]?.length || 0} added)
                  </h4>
                  
                  {/* Original Reminders */}
                  {item.reminders && item.reminders.length > 0 && (
                    <div style={{ marginBottom: '15px' }}>
                      {item.reminders
                        .filter((reminderWithPrice) => {
                          const reminderId = reminderWithPrice.reminder.id;
                          return reminderId && !removedReminders.has(reminderId);
                        })
                        .map((reminderWithPrice, reminderIdx) => {
                          const reminderId = reminderWithPrice.reminder.id || reminderIdx;
                          const feedbackKey = `reminder-${reminderId}`;
                          const feedbackStatus = reminderFeedback[feedbackKey];
                          const correction = reminderCorrections[feedbackKey];
                          const hasMatchedItem = reminderWithPrice.matchedItem?.name;
                          const hasMatch = !!hasMatchedItem || !!correction?.selectedItem;
                          const isConfirmed = confirmedMatchReminders.has(reminderId);
                          const showReminderValidationError = reminderValidationErrorIds.has(reminderId);

                          return (
                            <div
                              key={reminderId}
                              style={{
                                marginBottom: reminderIdx < item.reminders.filter((r) => {
                                  const id = r.reminder.id;
                                  return id && !removedReminders.has(id);
                                }).length - 1 ? '15px' : 0,
                                padding: '15px',
                                backgroundColor: isConfirmed ? '#e8f5e9' : feedbackStatus === 'correct' ? '#e8f5e9' : feedbackStatus === 'incorrect' ? '#ffebee' : '#fafafa',
                                border: isConfirmed ? '1px solid #4caf50' : feedbackStatus === 'correct' ? '1px solid #4caf50' : feedbackStatus === 'incorrect' ? '1px solid #f44336' : '1px solid #e0e0e0',
                                borderRadius: '4px',
                              }}
                            >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, marginBottom: '8px', color: '#333', fontSize: '16px' }}>
                                  {reminderWithPrice.reminder.description}
                                </div>
                                {reminderWithPrice.reminder.reminderType && (
                                  <div style={{ fontSize: '14px', color: '#666', marginBottom: '5px' }}>
                                    <strong>Type:</strong> {reminderWithPrice.reminder.reminderType}
                                  </div>
                                )}
                                {reminderWithPrice.reminder.dueDate && (
                                  <div style={{ fontSize: '14px', color: '#666', marginBottom: '5px' }}>
                                    <strong>Due Date:</strong> {formatDate(reminderWithPrice.reminder.dueDate)}
                                  </div>
                                )}
                                {reminderWithPrice.matchedItem?.name && (
                                  <div style={{ fontSize: '14px', color: '#666', marginBottom: '5px' }}>
                                    <strong>Matched Item:</strong> {reminderWithPrice.matchedItem.name}
                                    {reminderWithPrice.matchedItem.code && ` (${reminderWithPrice.matchedItem.code})`}
                                    {reminderWithPrice.itemType === 'inventory' && displayPatient.weight && (
                                      <span style={{ color: '#dc3545', marginLeft: '10px', fontWeight: 600 }}>
                                        Weight: {displayPatient.weight} lbs
                                      </span>
                                    )}
                                  </div>
                                )}
                                {reminderWithPrice.wellnessPlanPricing && reminderWithPrice.wellnessPlanPricing.hasCoverage && (
                                  <div style={{ 
                                    fontSize: '13px', 
                                    color: '#1976d2', 
                                    marginTop: '8px',
                                    padding: '6px 10px',
                                    backgroundColor: '#e3f2fd',
                                    borderRadius: '4px',
                                    border: '1px solid #90caf9',
                                    display: 'inline-block'
                                  }}>
                                    {reminderWithPrice.wellnessPlanPricing.priceAdjustedByMembership === true && 
                                     reminderWithPrice.wellnessPlanPricing.originalPrice !== reminderWithPrice.wellnessPlanPricing.adjustedPrice ? (
                                      <>
                                        <strong>Membership Discount:</strong> {reminderWithPrice.wellnessPlanPricing.membershipPlanName || 'Membership Plan'}
                                        {reminderWithPrice.wellnessPlanPricing.membershipDiscountAmount != null && reminderWithPrice.wellnessPlanPricing.membershipDiscountAmount > 0 && (
                                          <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1565c0' }}>
                                            Savings: ${reminderWithPrice.wellnessPlanPricing.membershipDiscountAmount.toFixed(2)}
                                          </span>
                                        )}
                                        {reminderWithPrice.wellnessPlanPricing.usedQuantity != null && reminderWithPrice.wellnessPlanPricing.includedQuantity != null && (
                                          <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1565c0' }}>
                                            ({reminderWithPrice.wellnessPlanPricing.usedQuantity} of {reminderWithPrice.wellnessPlanPricing.includedQuantity} used, {reminderWithPrice.wellnessPlanPricing.remainingQuantity} remaining)
                                          </span>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        {reminderWithPrice.wellnessPlanPricing.originalPrice !== reminderWithPrice.wellnessPlanPricing.adjustedPrice ? (
                                          <>
                                            <strong>Wellness Plan:</strong> ${reminderWithPrice.wellnessPlanPricing.originalPrice.toFixed(2)} → ${reminderWithPrice.wellnessPlanPricing.adjustedPrice.toFixed(2)}
                                            {reminderWithPrice.wellnessPlanPricing.isWithinLimit && (
                                              <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1565c0' }}>
                                                ({reminderWithPrice.wellnessPlanPricing.usedQuantity} of {reminderWithPrice.wellnessPlanPricing.includedQuantity} used, {reminderWithPrice.wellnessPlanPricing.remainingQuantity} remaining)
                                              </span>
                                            )}
                                          </>
                                        ) : (
                                          <>
                                            <strong>Wellness Plan Coverage:</strong>
                                            {reminderWithPrice.wellnessPlanPricing.remainingQuantity === 0 || !reminderWithPrice.wellnessPlanPricing.isWithinLimit ? (
                                              <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#d32f2f', fontWeight: 500 }}>
                                                Already used ({reminderWithPrice.wellnessPlanPricing.usedQuantity} of {reminderWithPrice.wellnessPlanPricing.includedQuantity} used)
                                              </span>
                                            ) : (
                                              <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1565c0' }}>
                                                ({reminderWithPrice.wellnessPlanPricing.usedQuantity} of {reminderWithPrice.wellnessPlanPricing.includedQuantity} used, {reminderWithPrice.wellnessPlanPricing.remainingQuantity} remaining)
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                                {reminderWithPrice.discountPricing && 
                                 reminderWithPrice.discountPricing.priceAdjustedByDiscount && (
                                  <>
                                    {reminderWithPrice.wellnessPlanPricing && 
                                     reminderWithPrice.wellnessPlanPricing.adjustedPrice === 0 ? (
                                      <div style={{ 
                                        fontSize: '13px', 
                                        color: '#1976d2', 
                                        marginTop: '8px',
                                        padding: '6px 10px',
                                        backgroundColor: '#e3f2fd',
                                        borderRadius: '4px',
                                        border: '1px solid #90caf9',
                                        display: 'inline-block'
                                      }}>
                                        <strong>Note:</strong> Discount ignored due to membership coverage
                                      </div>
                                    ) : (
                                      <div style={{ 
                                        fontSize: '13px', 
                                        color: '#2e7d32', 
                                        marginTop: '8px',
                                        padding: '6px 10px',
                                        backgroundColor: '#e8f5e9',
                                        borderRadius: '4px',
                                        border: '1px solid #81c784',
                                        display: 'inline-block'
                                      }}>
                                        <strong>Discount Applied:</strong>
                                        {reminderWithPrice.discountPricing.discountAmount != null && (
                                          <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1b5e20' }}>
                                            ${reminderWithPrice.discountPricing.discountAmount.toFixed(2)} off
                                          </span>
                                        )}
                                        {reminderWithPrice.discountPricing.discountPercentage != null && (
                                          <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1b5e20' }}>
                                            {reminderWithPrice.discountPricing.discountPercentage.toFixed(1)}% discount
                                          </span>
                                        )}
                                        {reminderWithPrice.discountPricing.clientDiscounts?.clientStatusDiscount && (
                                          <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1b5e20' }}>
                                            {reminderWithPrice.discountPricing.clientDiscounts.clientStatusDiscount.clientStatusName || 'Client Status'} Discount
                                          </span>
                                        )}
                                        {reminderWithPrice.discountPricing.clientDiscounts?.personalDiscount && (
                                          <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1b5e20' }}>
                                            Personal Discount Applied
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                                {!hasMatchedItem && correction?.selectedItem && (
                                  <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#e3f2fd', borderRadius: '4px', fontSize: '14px', color: '#1565c0', border: '1px solid #90caf9' }}>
                                    <strong>Selected Item:</strong> {correction.selectedItem.name}
                                    {correction.selectedItem.code && ` (${correction.selectedItem.code})`}
                                    <div style={{ marginTop: '5px', fontSize: '13px', color: '#1976d2' }}>
                                      Price: ${correction.selectedItem.price != null ? Number(correction.selectedItem.price).toFixed(2) : '0.00'}
                                    </div>
                                  </div>
                                )}
                                {reminderWithPrice.confidence != null && reminderWithPrice.confidence < 1 && (
                                  <div style={{ fontSize: '12px', color: '#999', marginTop: '5px', fontStyle: 'italic' }}>
                                    Confidence: {(reminderWithPrice.confidence * 100).toFixed(0)}%
                                  </div>
                                )}
                                {isConfirmed && (
                                  <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#c8e6c9', borderRadius: '4px', fontSize: '14px', color: '#2e7d32', fontWeight: 500 }}>
                                    ✓ Match confirmed
                                  </div>
                                )}
                                {!isConfirmed && feedbackStatus === 'correct' && (
                                  <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#c8e6c9', borderRadius: '4px', fontSize: '14px', color: '#2e7d32', fontWeight: 500 }}>
                                    ✓ Match confirmed as correct
                                    {correction?.selectedItem && !hasMatchedItem && (
                                      <div style={{ marginTop: '5px', fontSize: '13px' }}>
                                        Matched to: {correction.selectedItem.name}
                                        {correction.selectedItem.code && ` (${correction.selectedItem.code})`}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {feedbackStatus === 'incorrect' && correction?.selectedItem && (
                                  <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#ffcdd2', borderRadius: '4px', fontSize: '14px', color: '#c62828' }}>
                                    <strong>Corrected to:</strong> {correction.selectedItem.name}
                                    {correction.selectedItem.code && ` (${correction.selectedItem.code})`}
                                  </div>
                                )}
                              </div>
                              <div style={{ marginLeft: '15px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', minWidth: '150px', position: 'relative' }}>
                                {/* When confirmed: only Undo. Otherwise: Remove, Qty, Price */}
                                {isConfirmed ? (
                                  <button
                                    onClick={() => {
                                      setConfirmedMatchReminders((prev) => {
                                        const next = new Set(prev);
                                        next.delete(reminderId);
                                        return next;
                                      });
                                    }}
                                    style={{
                                      padding: '8px 16px',
                                      backgroundColor: '#6c757d',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontSize: '14px',
                                      fontWeight: 500,
                                    }}
                                  >
                                    Undo
                                  </button>
                                ) : (
                                  <>
                                {/* Remove Button */}
                                <button
                                  onClick={() => handleRemoveReminder(reminderId, reminderWithPrice.reminder.description)}
                                  style={{
                                    position: 'absolute',
                                    top: '0px',
                                    right: '0px',
                                    background: '#f44336',
                                    border: '1px solid #d32f2f',
                                    borderRadius: '4px',
                                    fontSize: '18px',
                                    cursor: 'pointer',
                                    color: 'white',
                                    padding: '4px 8px',
                                    minWidth: '28px',
                                    height: '28px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 'bold',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                                    transition: 'background-color 0.2s',
                                    zIndex: 10,
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = '#d32f2f';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = '#f44336';
                                  }}
                                  aria-label="Remove reminder"
                                >
                                  ×
                                </button>
                                {/* Quantity Field */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '35px' }}>
                                  <label style={{ fontSize: '14px', color: '#666', fontWeight: 500 }}>Qty:</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={reminderQuantities[reminderId] || 1}
                                    onChange={(e) => {
                                      const qty = parseInt(e.target.value, 10);
                                      handleQuantityChange(reminderId, qty);
                                    }}
                                    style={{
                                      width: '60px',
                                      padding: '6px 8px',
                                      fontSize: '14px',
                                      border: '1px solid #ced4da',
                                      borderRadius: '4px',
                                      textAlign: 'center',
                                    }}
                                  />
                                </div>
                                {/* Price Display */}
                                {(() => {
                                  // Backend already calculates final price with all discounts applied
                                  // Use the price field directly, or corrected item price if available
                                  let finalPrice = 0;
                                  let originalPrice = 0;
                                  const wellnessPricing = reminderWithPrice.wellnessPlanPricing;
                                  const discountPricing = reminderWithPrice.discountPricing;
                                  const hasPrice = reminderWithPrice.price != null;
                                  
                                  // Get final price (backend-calculated with all discounts)
                                  if (correction?.selectedItem?.price != null) {
                                    finalPrice = Number(correction.selectedItem.price);
                                    originalPrice = finalPrice;
                                  } else if (hasPrice) {
                                    finalPrice = Number(reminderWithPrice.price);
                                  } else {
                                    // No price available
                                    if (!hasPrice && !correction?.selectedItem && !wellnessPricing) {
                                      return (
                                        <div style={{ fontSize: '14px', color: '#999', fontStyle: 'italic' }}>
                                          No price available
                                        </div>
                                      );
                                    }
                                    finalPrice = 0;
                                  }
                                  
                                  // Get original price for display (to show strikethrough)
                                  let baseOriginalPrice = 0;
                                  if (correction?.selectedItem?.price != null) {
                                    baseOriginalPrice = Number(correction.selectedItem.price);
                                  } else if (wellnessPricing) {
                                    baseOriginalPrice = wellnessPricing.originalPrice;
                                  } else if (reminderWithPrice.matchedItem?.price) {
                                    baseOriginalPrice = Number(reminderWithPrice.matchedItem.price);
                                  } else {
                                    baseOriginalPrice = finalPrice;
                                  }
                                  
                                  // Get quantity and apply tiered pricing if available
                                  const quantity = reminderQuantities[reminderId] || 1;
                                  
                                  // Get tiered price for the current quantity
                                  // Check correction item tiered pricing first, then fall back to reminder tiered pricing
                                  let tieredOriginalPrice = baseOriginalPrice;
                                  const tieredPricing = correction?.selectedItem?.tieredPricing || reminderWithPrice.tieredPricing;
                                  if (tieredPricing?.hasTieredPricing) {
                                    tieredOriginalPrice = getTieredPrice(tieredPricing, quantity, baseOriginalPrice);
                                  }
                                  
                                  // Calculate the discount ratio from the backend response (for qty 1)
                                  const backendOriginalPrice = baseOriginalPrice;
                                  const backendAdjustedPrice = finalPrice;
                                  const discountRatio = backendOriginalPrice > 0 ? backendAdjustedPrice / backendOriginalPrice : 1;
                                  
                                  // Apply the same discount ratio to the tiered price
                                  const tieredFinalPrice = tieredOriginalPrice * discountRatio;
                                  
                                  const totalFinalPrice = tieredFinalPrice * quantity;
                                  const totalOriginalPrice = tieredOriginalPrice * quantity;
                                  
                                  // Show original price if there's any discount applied
                                  const hasAnyDiscount = (wellnessPricing && wellnessPricing.originalPrice !== wellnessPricing.adjustedPrice) || 
                                                         discountPricing?.priceAdjustedByDiscount;
                                  
                                  return (
                                    <>
                                      {hasAnyDiscount && totalOriginalPrice !== totalFinalPrice && (
                                        <div style={{ fontSize: '12px', color: '#999', textDecoration: 'line-through', marginBottom: '4px' }}>
                                          ${totalOriginalPrice.toFixed(2)}
                                        </div>
                                      )}
                                      <div style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32' }}>
                                        ${totalFinalPrice.toFixed(2)}
                                      </div>
                                      {tieredPricing?.hasTieredPricing && quantity > 1 && (
                                        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                                          ${tieredFinalPrice.toFixed(2)} each
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Validation error when reminder not confirmed / no match */}
                            {showReminderValidationError && (
                              <p style={{ margin: '10px 0 0', fontSize: '13px', color: '#dc3545' }}>
                                {hasMatch ? 'Click Confirm match or remove this reminder to continue.' : 'Match an item and confirm, or remove this reminder to continue.'}
                              </p>
                            )}

                            {/* Feedback Buttons - Only show when not confirmed. Confirm match only when has match. */}
                            {!isConfirmed && hasMatchedItem && !feedbackStatus && (
                              <div style={{ marginTop: '15px', display: 'flex', gap: '10px', paddingTop: '15px', borderTop: '1px solid #e0e0e0' }}>
                                <button
                                  onClick={() => {
                                    setReminderFeedback((prev) => ({ ...prev, [feedbackKey]: 'correcting' }));
                                    setReminderCorrections((prev) => ({
                                      ...prev,
                                      [feedbackKey]: { searchQuery: '', results: [], loading: false, selectedItem: null },
                                    }));
                                  }}
                                  disabled={feedbackStatus === 'correcting'}
                                  style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#f44336',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: feedbackStatus === 'correcting' ? 'not-allowed' : 'pointer',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    opacity: feedbackStatus === 'correcting' ? 0.6 : 1,
                                  }}
                                >
                                  ✗ Incorrect Match Globally
                                </button>
                                <button
                                  onClick={() => {
                                    setReminderFeedback((prev) => ({ ...prev, [feedbackKey]: 'correcting' }));
                                    setReminderCorrections((prev) => ({
                                      ...prev,
                                      [feedbackKey]: { searchQuery: '', results: [], loading: false, selectedItem: null, patientId: patient.id },
                                    }));
                                  }}
                                  disabled={feedbackStatus === 'correcting'}
                                  style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#ff9800',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: feedbackStatus === 'correcting' ? 'not-allowed' : 'pointer',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    opacity: feedbackStatus === 'correcting' ? 0.6 : 1,
                                  }}
                                >
                                  Update for Patient Only
                                </button>
                                <button
                                  onClick={() => {
                                    setConfirmedMatchReminders((prev) => new Set(prev).add(reminderId));
                                    setReminderValidationErrorIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(reminderId);
                                      return next;
                                    });
                                  }}
                                  style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#4caf50',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                  }}
                                >
                                  Confirm match
                                </button>
                              </div>
                            )}

                            {/* When user selected item via search (no original match): show scope options then Confirm match */}
                            {!isConfirmed && !hasMatchedItem && correction?.selectedItem && !feedbackStatus && (
                              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0' }}>
                                <p style={{ fontSize: '14px', fontWeight: 500, color: '#333', marginBottom: '10px' }}>
                                  Apply this match:
                                </p>
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                                  <button
                                    onClick={() => {
                                      setReminderCorrections((prev) => ({
                                        ...prev,
                                        [feedbackKey]: { ...prev[feedbackKey], patientId: undefined, scopeChosen: true },
                                      }));
                                    }}
                                    style={{
                                      padding: '8px 16px',
                                      backgroundColor: correction?.scopeChosen && correction?.patientId === undefined ? '#2196f3' : '#e0e0e0',
                                      color: correction?.scopeChosen && correction?.patientId === undefined ? 'white' : '#333',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontSize: '14px',
                                      fontWeight: 500,
                                    }}
                                  >
                                    Match globally
                                  </button>
                                  <button
                                    onClick={() => {
                                      setReminderCorrections((prev) => ({
                                        ...prev,
                                        [feedbackKey]: { ...prev[feedbackKey], patientId: patient.id, scopeChosen: true },
                                      }));
                                    }}
                                    style={{
                                      padding: '8px 16px',
                                      backgroundColor: correction?.scopeChosen && correction?.patientId === patient.id ? '#2196f3' : '#e0e0e0',
                                      color: correction?.scopeChosen && correction?.patientId === patient.id ? 'white' : '#333',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontSize: '14px',
                                      fontWeight: 500,
                                    }}
                                  >
                                    Match for this patient only
                                  </button>
                                </div>
                                {correction?.scopeChosen && (
                                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    <button
                                      onClick={async () => {
                                        if (!correction?.selectedItem) return;
                                        try {
                                          await handleSubmitCorrection(
                                            reminderId,
                                            reminderWithPrice.reminder.description,
                                            correction.selectedItem,
                                            reminderWithPrice,
                                            correction.patientId
                                          );
                                          setConfirmedMatchReminders((prev) => new Set(prev).add(reminderId));
                                          setReminderValidationErrorIds((prev) => {
                                            const next = new Set(prev);
                                            next.delete(reminderId);
                                            return next;
                                          });
                                        } catch (err: any) {
                                          console.error('Error submitting match:', err);
                                          alert(err?.message || 'Failed to submit match. Please try again.');
                                        }
                                      }}
                                      style={{
                                        padding: '8px 16px',
                                        backgroundColor: '#4caf50',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 500,
                                      }}
                                    >
                                      Confirm match
                                    </button>
                                    <button
                                      onClick={() => {
                                        setReminderCorrections((prev) => ({
                                          ...prev,
                                          [feedbackKey]: { searchQuery: '', results: [], loading: false, selectedItem: null, scopeChosen: false },
                                        }));
                                      }}
                                      style={{
                                        padding: '8px 16px',
                                        backgroundColor: '#6c757d',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 500,
                                      }}
                                    >
                                      Clear Selection
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Search for Match - Show for reminders without matches */}
                            {!hasMatch && !feedbackStatus && (
                              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0' }}>
                                <div style={{ marginBottom: '15px', fontSize: '14px', fontWeight: 500, color: '#333' }}>
                                  No match found. Search for the correct item:
                                </div>
                                <div style={{ position: 'relative' }}>
                                  <input
                                    type="text"
                                    placeholder="Search for items (e.g., Bravecto, Heartworm Test)..."
                                    value={correction?.searchQuery || ''}
                                    onChange={(e) => {
                                      const query = e.target.value;
                                      setReminderCorrections((prev) => ({
                                        ...prev,
                                        [feedbackKey]: { ...prev[feedbackKey], searchQuery: query, results: [], loading: false },
                                      }));
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '12px 15px',
                                      fontSize: '16px',
                                      border: '1px solid #ced4da',
                                      borderRadius: '6px',
                                      boxSizing: 'border-box',
                                      transition: 'border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                                    }}
                                    onFocus={(e) => {
                                      e.currentTarget.style.borderColor = '#80bdff';
                                      e.currentTarget.style.boxShadow = '0 0 0 0.2rem rgba(0,123,255,.25)';
                                    }}
                                    onBlur={(e) => {
                                      e.currentTarget.style.borderColor = '#ced4da';
                                      e.currentTarget.style.boxShadow = 'none';
                                    }}
                                  />
                                  {correction?.loading && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        right: '15px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: '#666',
                                        fontSize: '14px',
                                      }}
                                    >
                                      Searching...
                                    </div>
                                  )}
                                </div>

                                {/* Search Results */}
                                {correction?.results && correction.results.length > 0 && (
                                  <div
                                    style={{
                                      marginTop: '10px',
                                      maxHeight: '200px',
                                      overflowY: 'auto',
                                      border: '1px solid #ced4da',
                                      borderRadius: '4px',
                                      backgroundColor: '#fff',
                                    }}
                                  >
                                    {correction.results.map((result, resultIdx) => (
                                      <div
                                        key={`${result.name}-${result.code}-${resultIdx}`}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          // Select the item; scope (global vs patient) must be chosen before Confirm match
                                          setReminderCorrections((prev) => ({
                                            ...prev,
                                            [feedbackKey]: { searchQuery: '', results: [], loading: false, selectedItem: result, scopeChosen: false },
                                          }));
                                        }}
                                        style={{
                                          padding: '12px',
                                          cursor: 'pointer',
                                          borderBottom: resultIdx < correction.results.length - 1 ? '1px solid #e9ecef' : 'none',
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          transition: 'background-color 0.2s ease-in-out',
                                          backgroundColor: correction?.selectedItem === result ? '#e3f2fd' : '#fff',
                                        }}
                                        onMouseEnter={(e) => {
                                          if (correction?.selectedItem !== result) {
                                            e.currentTarget.style.backgroundColor = '#f8f9fa';
                                          }
                                        }}
                                        onMouseLeave={(e) => {
                                          if (correction?.selectedItem !== result) {
                                            e.currentTarget.style.backgroundColor = '#fff';
                                          }
                                        }}
                                      >
                                        <div style={{ flex: 1 }}>
                                          <div style={{ fontWeight: 500, color: '#212529' }}>{result.name}</div>
                                          {result.code && (
                                            <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '2px' }}>
                                              {result.code} • {result.itemType}
                                            </div>
                                          )}
                                        </div>
                                        <div style={{ marginLeft: '15px', fontWeight: 600, color: '#2e7d32' }}>
                                          ${result.price != null ? Number(result.price).toFixed(2) : '0.00'}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {correction?.loading === false && correction?.searchQuery && correction.searchQuery.trim().length >= 2 && correction.results?.length === 0 && (
                                  <div style={{ padding: '12px', color: '#6c757d', fontStyle: 'italic', marginTop: '10px' }}>
                                    No items found for "{correction.searchQuery}"
                                  </div>
                                )}

                                {/* Submit Match Button - Show when item is selected */}
                                {correction?.selectedItem && (
                                  <div style={{ marginTop: '15px', display: 'flex', gap: '10px', paddingTop: '15px', borderTop: '1px solid #e0e0e0' }}>
                                    <button
                                      onClick={() => {
                                        // Clear selection
                                        setReminderCorrections((prev) => ({
                                          ...prev,
                                          [feedbackKey]: { searchQuery: '', results: [], loading: false, selectedItem: null },
                                        }));
                                      }}
                                      style={{
                                        padding: '8px 16px',
                                        backgroundColor: '#6c757d',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 500,
                                      }}
                                    >
                                      Clear Selection
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Correction Search */}
                            {!isConfirmed && feedbackStatus === 'correcting' && (
                              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0' }}>
                                <div style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 500, color: '#333' }}>
                                  {correction?.patientId ? 'Search for the correct item (Patient-specific match):' : 'Search for the correct item:'}
                                </div>
                                <div style={{ position: 'relative', marginBottom: '10px' }}>
                                  <input
                                    type="text"
                                    placeholder="Search for items (e.g., Bravecto, Heartworm Test)..."
                                    value={correction?.searchQuery || ''}
                                    onChange={(e) => {
                                      const query = e.target.value;
                                      setReminderCorrections((prev) => ({
                                        ...prev,
                                        [feedbackKey]: { ...prev[feedbackKey], searchQuery: query, results: [], loading: false },
                                      }));
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '10px 12px',
                                      fontSize: '14px',
                                      border: '1px solid #ced4da',
                                      borderRadius: '4px',
                                      boxSizing: 'border-box',
                                    }}
                                  />
                                  {correction?.loading && (
                                    <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#6c757d', fontSize: '12px' }}>
                                      Searching...
                                    </div>
                                  )}
                                </div>

                                {/* Correction Search Results */}
                                {correction?.results && correction.results.length > 0 && (
                                  <div
                                    style={{
                                      maxHeight: '200px',
                                      overflowY: 'auto',
                                      backgroundColor: '#fff',
                                      border: '1px solid #ced4da',
                                      borderRadius: '4px',
                                      marginBottom: '10px',
                                    }}
                                  >
                                    {correction.results.map((result, resultIdx) => (
                                      <div
                                        key={`${result.name}-${result.code}-${resultIdx}`}
                                        onClick={() => handleSelectCorrection(reminderId, result)}
                                        style={{
                                          padding: '10px 12px',
                                          borderBottom: resultIdx < correction.results.length - 1 ? '1px solid #eee' : 'none',
                                          cursor: 'pointer',
                                          backgroundColor: correction?.selectedItem === result ? '#e3f2fd' : '#fff',
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                        }}
                                        onMouseEnter={(e) => {
                                          if (correction?.selectedItem !== result) {
                                            e.currentTarget.style.backgroundColor = '#f8f9fa';
                                          }
                                        }}
                                        onMouseLeave={(e) => {
                                          if (correction?.selectedItem !== result) {
                                            e.currentTarget.style.backgroundColor = '#fff';
                                          }
                                        }}
                                      >
                                        <div>
                                          <div style={{ fontWeight: 500, color: '#333', fontSize: '14px' }}>
                                            {result.name} {result.code && `(${result.code})`}
                                          </div>
                                          <div style={{ fontSize: '12px', color: '#6c757d' }}>
                                            Type: {result.itemType}
                                          </div>
                                        </div>
                                        <div style={{ fontWeight: 600, color: '#2e7d32', fontSize: '14px' }}>
                                          ${result.price != null ? Number(result.price).toFixed(2) : '0.00'}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Submit Correction Buttons */}
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                  {correction?.selectedItem && (
                                    <button
                                      onClick={() => handleSubmitCorrection(reminderId, reminderWithPrice.reminder.description, correction.selectedItem!, reminderWithPrice, correction.patientId)}
                                      style={{
                                        padding: '8px 16px',
                                        backgroundColor: '#2196f3',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 500,
                                      }}
                                    >
                                      {correction.patientId ? 'Submit Match for Patient' : 'Submit Correction'}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleReminderFeedback(reminderId, reminderWithPrice.reminder.description, false, reminderWithPrice)}
                                    style={{
                                      padding: '8px 16px',
                                      backgroundColor: '#f44336',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontSize: '14px',
                                      fontWeight: 500,
                                    }}
                                  >
                                    Mark as Incorrect (No Correction)
                                  </button>
                                  <button
                                    onClick={() => {
                                      setReminderFeedback((prev) => ({ ...prev, [feedbackKey]: null }));
                                      setReminderCorrections((prev) => ({
                                        ...prev,
                                        [feedbackKey]: { searchQuery: '', results: [], loading: false, selectedItem: null },
                                      }));
                                    }}
                                    style={{
                                      padding: '8px 16px',
                                      backgroundColor: '#6c757d',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontSize: '14px',
                                      fontWeight: 500,
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Added Items */}
                  {addedItems[patient.id] && addedItems[patient.id].length > 0 && (
                    <div style={{ marginBottom: '15px' }}>
                      {addedItems[patient.id].map((item, itemIdx) => (
                        <div
                          key={`added-${itemIdx}`}
                          style={{
                            marginBottom: itemIdx < addedItems[patient.id].length - 1 ? '15px' : 0,
                            padding: '15px',
                            backgroundColor: '#fff3cd',
                            border: '1px solid #ffc107',
                            borderRadius: '4px',
                            position: 'relative',
                          }}
                        >
                          <button
                            onClick={() => handleRemoveAddedItem(patient.id, itemIdx)}
                            style={{
                              position: 'absolute',
                              top: '0px',
                              right: '0px',
                              background: 'none',
                              border: 'none',
                              fontSize: '20px',
                              cursor: 'pointer',
                              color: '#666',
                              padding: '0',
                              width: '24px',
                              height: '24px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            aria-label="Remove item"
                          >
                            ×
                          </button>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, paddingRight: '30px' }}>
                              <div style={{ fontWeight: 600, marginBottom: '8px', color: '#333', fontSize: '16px' }}>
                                {item.name}
                              </div>
                              {item.code && (
                                <div style={{ fontSize: '14px', color: '#666', marginBottom: '5px' }}>
                                  <strong>Code:</strong> {item.code}
                                </div>
                              )}
                              <div style={{ fontSize: '14px', color: '#666', marginBottom: '5px' }}>
                                <strong>Type:</strong> {item.itemType}
                              </div>
                              {item.wellnessPlanPricing && item.wellnessPlanPricing.hasCoverage && (
                                <div style={{ 
                                  fontSize: '13px', 
                                  color: '#1976d2', 
                                  marginTop: '8px',
                                  padding: '6px 10px',
                                  backgroundColor: '#e3f2fd',
                                  borderRadius: '4px',
                                  border: '1px solid #90caf9',
                                  display: 'inline-block'
                                }}>
                                  {item.wellnessPlanPricing.priceAdjustedByMembership ? (
                                    <>
                                      <strong>Membership Discount:</strong> {item.wellnessPlanPricing.membershipPlanName || 'Membership Plan'}
                                      {item.wellnessPlanPricing.membershipDiscountAmount != null && item.wellnessPlanPricing.membershipDiscountAmount > 0 && (
                                        <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1565c0' }}>
                                          Savings: ${item.wellnessPlanPricing.membershipDiscountAmount.toFixed(2)}
                                        </span>
                                      )}
                                      {item.wellnessPlanPricing.usedQuantity != null && item.wellnessPlanPricing.includedQuantity != null && (
                                        <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1565c0' }}>
                                          ({item.wellnessPlanPricing.usedQuantity} of {item.wellnessPlanPricing.includedQuantity} used, {item.wellnessPlanPricing.remainingQuantity} remaining)
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      {item.wellnessPlanPricing.originalPrice !== item.wellnessPlanPricing.adjustedPrice ? (
                                        <>
                                          <strong>Wellness Plan:</strong> ${item.wellnessPlanPricing.originalPrice.toFixed(2)} → ${item.wellnessPlanPricing.adjustedPrice.toFixed(2)}
                                          {item.wellnessPlanPricing.isWithinLimit && (
                                            <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1565c0' }}>
                                              ({item.wellnessPlanPricing.usedQuantity} of {item.wellnessPlanPricing.includedQuantity} used, {item.wellnessPlanPricing.remainingQuantity} remaining)
                                            </span>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          <strong>Wellness Plan Coverage:</strong>
                                          {item.wellnessPlanPricing.remainingQuantity === 0 || !item.wellnessPlanPricing.isWithinLimit ? (
                                            <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#d32f2f', fontWeight: 500 }}>
                                              Already used ({item.wellnessPlanPricing.usedQuantity} of {item.wellnessPlanPricing.includedQuantity} used)
                                            </span>
                                          ) : (
                                            <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1565c0' }}>
                                              ({item.wellnessPlanPricing.usedQuantity} of {item.wellnessPlanPricing.includedQuantity} used, {item.wellnessPlanPricing.remainingQuantity} remaining)
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                              {item.discountPricing && 
                               item.discountPricing.priceAdjustedByDiscount && (
                                <>
                                  {item.wellnessPlanPricing && 
                                   item.wellnessPlanPricing.adjustedPrice === 0 ? (
                                    <div style={{ 
                                      fontSize: '13px', 
                                      color: '#1976d2', 
                                      marginTop: '8px',
                                      padding: '6px 10px',
                                      backgroundColor: '#e3f2fd',
                                      borderRadius: '4px',
                                      border: '1px solid #90caf9',
                                      display: 'inline-block'
                                    }}>
                                      <strong>Note:</strong> Discount ignored due to membership coverage
                                    </div>
                                  ) : (
                                    <div style={{ 
                                      fontSize: '13px', 
                                      color: '#2e7d32', 
                                      marginTop: '8px',
                                      padding: '6px 10px',
                                      backgroundColor: '#e8f5e9',
                                      borderRadius: '4px',
                                      border: '1px solid #81c784',
                                      display: 'inline-block'
                                    }}>
                                      <strong>Discount Applied:</strong>
                                      {item.discountPricing.discountAmount != null && (
                                        <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1b5e20' }}>
                                          ${item.discountPricing.discountAmount.toFixed(2)} off
                                        </span>
                                      )}
                                      {item.discountPricing.discountPercentage != null && (
                                        <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1b5e20' }}>
                                          {item.discountPricing.discountPercentage.toFixed(1)}% discount
                                        </span>
                                      )}
                                      {item.discountPricing.clientDiscounts?.clientStatusDiscount && (
                                        <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1b5e20' }}>
                                          {item.discountPricing.clientDiscounts.clientStatusDiscount.clientStatusName || 'Client Status'} Discount
                                        </span>
                                      )}
                                      {item.discountPricing.clientDiscounts?.personalDiscount && (
                                        <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', color: '#1b5e20' }}>
                                          Personal Discount Applied
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                            <div style={{ marginLeft: '15px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', minWidth: '150px' }}>
                              {/* Quantity Field */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <label style={{ fontSize: '14px', color: '#666', fontWeight: 500 }}>Qty:</label>
                                <input
                                  type="number"
                                  min="1"
                                  value={addedItemQuantities[`${patient.id}-${itemIdx}`] || 1}
                                  onChange={(e) => {
                                    const qty = parseInt(e.target.value, 10);
                                    handleAddedItemQuantityChange(patient.id, itemIdx, qty);
                                  }}
                                  style={{
                                    width: '60px',
                                    padding: '6px 8px',
                                    fontSize: '14px',
                                    border: '1px solid #ced4da',
                                    borderRadius: '4px',
                                    textAlign: 'center',
                                  }}
                                />
                              </div>
                              {/* Price Display */}
                              {(() => {
                                const quantity = addedItemQuantities[`${patient.id}-${itemIdx}`] || 1;
                                
                                // Get the base original price (for qty 1)
                                const baseOriginalPrice = item.wellnessPlanPricing?.originalPrice ?? 
                                                         item.originalPrice ?? 
                                                         (item.price != null ? Number(item.price) : 0);
                                
                                // Get tiered price for the current quantity
                                let tieredOriginalPrice = baseOriginalPrice;
                                if (item.tieredPricing?.hasTieredPricing) {
                                  tieredOriginalPrice = getTieredPrice(item.tieredPricing, quantity, baseOriginalPrice);
                                }
                                
                                // Calculate the discount ratio from the backend response (for qty 1)
                                // The backend gives us adjustedPrice and originalPrice for qty 1
                                const backendOriginalPrice = item.originalPrice ?? baseOriginalPrice;
                                const backendAdjustedPrice = item.price ?? 0;
                                const discountRatio = backendOriginalPrice > 0 ? backendAdjustedPrice / backendOriginalPrice : 1;
                                
                                // Apply the same discount ratio to the tiered price
                                let finalPrice = tieredOriginalPrice * discountRatio;
                                
                                // Get original price for display (tiered price before discounts)
                                const originalPrice = tieredOriginalPrice;
                                
                                const totalFinalPrice = finalPrice * quantity;
                                const totalOriginalPrice = originalPrice * quantity;
                                
                                // Show original price if there's any discount applied
                                const hasAnyDiscount = (item.wellnessPlanPricing && item.wellnessPlanPricing.originalPrice !== item.wellnessPlanPricing.adjustedPrice) || 
                                                       item.discountPricing?.priceAdjustedByDiscount;
                                
                                return (
                                  <>
                                    {hasAnyDiscount && totalOriginalPrice !== totalFinalPrice && totalOriginalPrice > totalFinalPrice && (
                                      <div style={{ fontSize: '12px', color: '#999', textDecoration: 'line-through', marginBottom: '4px' }}>
                                        ${totalOriginalPrice.toFixed(2)}
                                      </div>
                                    )}
                                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32' }}>
                                      ${totalFinalPrice.toFixed(2)}
                                    </div>
                                    {item.tieredPricing?.hasTieredPricing && quantity > 1 && (
                                      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                                        ${finalPrice.toFixed(2)} each
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Total */}
                  {((item.reminders && item.reminders.filter((r) => {
                    const id = r.reminder.id;
                    return id && !removedReminders.has(id);
                  }).length > 0) || (addedItems[patient.id] && addedItems[patient.id].length > 0)) && (
                    <div
                      style={{
                        marginTop: '15px',
                        padding: '12px',
                        backgroundColor: '#e8f5e9',
                        border: '1px solid #4caf50',
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '16px', color: '#333' }}>Total:</div>
                      <div style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32' }}>
                        $
                        {(
                        (item.reminders
                          ?.filter((r) => {
                            const id = r.reminder.id;
                            return id && !removedReminders.has(id);
                          })
                          .reduce((sum, r) => {
                            // For reminders with selected/corrected items, use selected item price
                            const reminderId = r.reminder.id;
                            const correctionKey = `reminder-${reminderId}`;
                            const correction = reminderCorrections[correctionKey];
                          
                          // Get base price
                          let basePrice = 0;
                          let baseOriginalPrice = 0;
                          
                          if (correction?.selectedItem?.price != null) {
                            basePrice = Number(correction.selectedItem.price);
                            baseOriginalPrice = basePrice;
                          } else if (r.price != null) {
                            basePrice = Number(r.price);
                            baseOriginalPrice = r.wellnessPlanPricing?.originalPrice ?? 
                                              (r.matchedItem?.price ? Number(r.matchedItem.price) : basePrice);
                          }
                          
                          // Get quantity and apply tiered pricing if available
                          const quantity = reminderQuantities[reminderId] || 1;
                          
                          // Get tiered price for the current quantity
                          // Check correction item tiered pricing first, then fall back to reminder tiered pricing
                          let tieredOriginalPrice = baseOriginalPrice;
                          const tieredPricing = correction?.selectedItem?.tieredPricing || r.tieredPricing;
                          if (tieredPricing?.hasTieredPricing) {
                            tieredOriginalPrice = getTieredPrice(tieredPricing, quantity, baseOriginalPrice);
                          }
                          
                          // Calculate the discount ratio from the backend response (for qty 1)
                          const discountRatio = baseOriginalPrice > 0 ? basePrice / baseOriginalPrice : 1;
                          
                          // Apply the same discount ratio to the tiered price
                          const tieredFinalPrice = tieredOriginalPrice * discountRatio;
                          
                          return sum + (tieredFinalPrice * quantity);
                        }, 0) || 0) +
                        (addedItems[patient.id]?.reduce((sum, item, itemIdx) => {
                          const quantity = addedItemQuantities[`${patient.id}-${itemIdx}`] || 1;
                          
                          // Calculate price with tiered pricing if applicable
                          const baseOriginalPrice = item.wellnessPlanPricing?.originalPrice ?? 
                                                   item.originalPrice ?? 
                                                   (item.price != null ? Number(item.price) : 0);
                          
                          let tieredOriginalPrice = baseOriginalPrice;
                          if (item.tieredPricing?.hasTieredPricing) {
                            tieredOriginalPrice = getTieredPrice(item.tieredPricing, quantity, baseOriginalPrice);
                          }
                          
                          // Calculate the discount ratio from the backend response (for qty 1)
                          const backendOriginalPrice = item.originalPrice ?? baseOriginalPrice;
                          const backendAdjustedPrice = item.price ?? 0;
                          const discountRatio = backendOriginalPrice > 0 ? backendAdjustedPrice / backendOriginalPrice : 1;
                          
                          // Apply the same discount ratio to the tiered price
                          const finalPrice = tieredOriginalPrice * discountRatio;
                          
                          return sum + (finalPrice * quantity);
                        }, 0) || 0)
                      ).toFixed(2)}
                      </div>
                    </div>
                  )}

                  {/* Search Box */}
                  <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                    <h5 style={{ marginTop: 0, marginBottom: '10px', color: '#495057', fontSize: '16px', fontWeight: 600 }}>
                      Add Item
                      {displayPatient.weight && (
                        <span style={{ color: '#dc3545', marginLeft: '10px', fontWeight: 600 }}>
                          Weight: {displayPatient.weight} lbs
                        </span>
                      )}
                    </h5>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        placeholder="Search for items (e.g., Bravecto, Heartworm Test)..."
                        value={searchQuery[patient.id] || ''}
                        onChange={(e) => {
                          const query = e.target.value;
                          setSearchQuery((prev) => ({ ...prev, [patient.id]: query }));
                        }}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          fontSize: '14px',
                          border: '1px solid #ced4da',
                          borderRadius: '4px',
                          boxSizing: 'border-box',
                        }}
                      />
                      {searchLoading[patient.id] && (
                        <div
                          style={{
                            position: 'absolute',
                            right: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            color: '#666',
                            fontSize: '12px',
                          }}
                        >
                          Searching...
                        </div>
                      )}
                    </div>

                    {/* Search Results */}
                    {searchResults[patient.id] && searchResults[patient.id].length > 0 && (
                      <div
                        style={{
                          marginTop: '10px',
                          maxHeight: '200px',
                          overflowY: 'auto',
                          border: '1px solid #ced4da',
                          borderRadius: '4px',
                          backgroundColor: '#fff',
                        }}
                      >
                        {searchResults[patient.id].map((result, resultIdx) => (
                          <div
                            key={resultIdx}
                            onClick={() => handleAddItem(patient.id, result)}
                            style={{
                              padding: '12px',
                              cursor: 'pointer',
                              borderBottom: resultIdx < searchResults[patient.id].length - 1 ? '1px solid #e9ecef' : 'none',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#f8f9fa';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#fff';
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 500, color: '#212529' }}>{result.name}</div>
                              {result.code && (
                                <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '2px' }}>
                                  {result.code} • {result.itemType}
                                </div>
                              )}
                            </div>
                            <div style={{ marginLeft: '15px', fontWeight: 600, color: '#2e7d32' }}>
                              ${result.price != null ? Number(result.price).toFixed(2) : '0.00'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchQuery[patient.id] &&
                      searchQuery[patient.id].length >= 2 &&
                      !searchLoading[patient.id] &&
                      searchResults[patient.id] &&
                      searchResults[patient.id].length === 0 && (
                        <div style={{ marginTop: '10px', padding: '10px', color: '#6c757d', fontSize: '14px', fontStyle: 'italic' }}>
                          No items found
                        </div>
                      )}
                  </div>

                  {/* Sharps Checkbox */}
                  <div style={{ marginTop: '20px', marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {(() => {
                        const checkboxes = vaccineCheckboxes[patient.id] || { felv: true, lepto: true, lyme: true, bordatella: true, sharps: true };
                        
                        // Calculate sharps based on any vaccine being checked (logic preserved but UI hidden)
                        const anyVaccineChecked = checkboxes.felv || checkboxes.lepto || checkboxes.lyme || checkboxes.bordatella;
                        const sharpsChecked = checkboxes.sharps !== undefined ? checkboxes.sharps : anyVaccineChecked;

                        return (
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
                            <input
                              type="checkbox"
                              checked={sharpsChecked}
                              onChange={(e) => {
                                setVaccineCheckboxes((prev) => ({
                                  ...prev,
                                  [patient.id]: { ...checkboxes, sharps: e.target.checked },
                                }));
                              }}
                              style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                            />
                            <span style={{ fontSize: '14px', color: '#333', fontWeight: 500 }}>Charge for Sharps</span>
                          </label>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
          )}

          {/* Action Buttons */}
          {selectedRoomLoader && (
            <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '2px solid #ddd', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={handleSaveForLater}
                disabled={savingForm}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: 600,
                  backgroundColor: savingForm ? '#6c757d' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: savingForm ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s ease-in-out',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }}
                onMouseEnter={(e) => {
                  if (!savingForm) {
                    e.currentTarget.style.backgroundColor = '#218838';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!savingForm) {
                    e.currentTarget.style.backgroundColor = '#28a745';
                  }
                }}
              >
                {savingForm ? 'Saving...' : 'Save for Later'}
              </button>
              <button
                onClick={handleSendToClient}
                disabled={sendingToClient}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: 600,
                  backgroundColor: sendingToClient ? '#6c757d' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: sendingToClient ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s ease-in-out',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }}
                onMouseEnter={(e) => {
                  if (!sendingToClient) {
                    e.currentTarget.style.backgroundColor = '#0056b3';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!sendingToClient) {
                    e.currentTarget.style.backgroundColor = '#007bff';
                  }
                }}
              >
                {sendingToClient
                  ? 'Sending...'
                  : selectedRoomLoader.sentStatus === 'not_sent'
                    ? 'Send to Client'
                    : 'Re-send to Client'}
              </button>
            </div>
          )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Removing Reminder */}
      {reminderToRemove && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={cancelRemoveReminder}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '8px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '15px', color: '#333', fontSize: '20px' }}>
              Remove Reminder?
            </h2>
            <p style={{ marginBottom: '20px', color: '#666', fontSize: '16px', lineHeight: '1.5' }}>
              Are you sure you want to remove <strong>"{reminderToRemove.description}"</strong>?
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={cancelRemoveReminder}
                style={{
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: 500,
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveReminder}
                style={{
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: 500,
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

