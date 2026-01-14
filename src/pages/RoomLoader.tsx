// src/pages/RoomLoader.tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { DateTime } from 'luxon';
import {
  searchRoomLoaders,
  getRoomLoader,
  searchItems,
  submitReminderFeedback,
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
      // Initialize appointment reasons from appointment descriptions/instructions
      if (data?.appointments && Array.isArray(data.appointments)) {
        setAppointmentReasons((prev) => {
          const updated = { ...prev };
          // Group appointments by patient and use the first appointment's description
          const patientAppointments = new Map<number, Appointment>();
          data.appointments!.forEach((apt) => {
            if (apt.patient?.id) {
              if (!patientAppointments.has(apt.patient.id)) {
                patientAppointments.set(apt.patient.id, apt);
              }
            }
          });
          patientAppointments.forEach((apt, patientId) => {
            if (!(patientId in updated)) {
              updated[patientId] = apt.description || apt.instructions || '';
            }
          });
          return updated;
        });
      }
      // Initialize vaccine checkboxes based on declinedInventoryItems
      if (data?.patients && Array.isArray(data.patients)) {
        setVaccineCheckboxes((prev) => {
          const updated = { ...prev };
          const declinedItems = data.declinedInventoryItems || [];
          
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
              
              // Check if any declined items match vaccine names
              declinedItems.forEach((declinedItem) => {
                const name = (declinedItem.name || '').toLowerCase();
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

  function handleAddItem(petId: number, item: SearchableItem) {
    setAddedItems((prev) => ({
      ...prev,
      [petId]: [...(prev[petId] || []), item],
    }));
    // Clear search
    setSearchQuery((prev) => ({ ...prev, [petId]: '' }));
    setSearchResults((prev) => ({ ...prev, [petId]: [] }));
  }

  function handleRemoveAddedItem(petId: number, index: number) {
    setAddedItems((prev) => {
      const items = prev[petId] || [];
      return {
        ...prev,
        [petId]: items.filter((_, i) => i !== index),
      };
    });
  }

  // Reminder feedback state
  const [reminderFeedback, setReminderFeedback] = useState<Record<string, 'correct' | 'incorrect' | 'correcting' | null>>({});
  const [reminderCorrections, setReminderCorrections] = useState<Record<string, { searchQuery: string; results: SearchableItem[]; loading: boolean; selectedItem: SearchableItem | null }>>({});
  // Store quantities for each reminder (keyed by reminderId)
  const [reminderQuantities, setReminderQuantities] = useState<Record<number, number>>({});
  // Store edited reason for appointment for each patient (keyed by patient.id)
  const [appointmentReasons, setAppointmentReasons] = useState<Record<number, string>>({});
  // Store checkbox states for each patient (keyed by patient.id)
  const [vaccineCheckboxes, setVaccineCheckboxes] = useState<Record<number, { felv: boolean; lepto: boolean; lyme: boolean; bordatella: boolean; sharps: boolean }>>({});
  
  // Loading state for sending to client
  const [sendingToClient, setSendingToClient] = useState(false);

  async function handleReminderFeedback(
    reminderId: number,
    reminderText: string,
    isCorrect: boolean,
    reminderWithPrice?: ReminderWithPrice,
    correctItem?: SearchableItem
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

  function handleSubmitCorrection(reminderId: number, reminderText: string, item: SearchableItem, reminderWithPrice?: ReminderWithPrice) {
    handleReminderFeedback(reminderId, reminderText, false, reminderWithPrice, item);
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
        appointmentReason: appointmentReasons[patient.id] || firstAppt?.description || firstAppt?.instructions || '',
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

    return {
      roomLoaderId: selectedRoomLoader.id,
      practiceId: selectedRoomLoader.practice.id,
      practiceName: selectedRoomLoader.practice.name,
      sentStatus: selectedRoomLoader.sentStatus,
      dueStatus: selectedRoomLoader.dueStatus,
      patients: patientData,
    };
  }

  // Handle sending to client
  async function handleSendToClient() {
    if (!selectedRoomLoader) return;

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
            pimsId: null,
            pimsType: undefined,
            firstName: firstClient.firstName || '',
            lastName: firstClient.lastName || '',
            email: firstClient.email || null,
            phone1: firstClient.phone1 || null,
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
          // Use appointment client if available and patient doesn't have one
          if (!existing.client && apt.client) {
            existing.client = apt.client;
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
                pimsId: null,
                pimsType: undefined,
                firstName: aptClient.firstName || '',
                lastName: aptClient.lastName || '',
                email: aptClient.email || null,
                phone1: aptClient.phone1 || null,
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
          {/* Room Loader Summary */}
          <div style={{ marginBottom: '30px', paddingBottom: '20px', borderBottom: '2px solid #ddd' }}>
            <KeyValue k="ID" v={selectedRoomLoader.id} />
            <KeyValue k="PIMS ID" v={selectedRoomLoader.pimsId || 'N/A'} />
            <KeyValue k="Practice" v={selectedRoomLoader.practice?.name || 'N/A'} />
            <KeyValue
              k="Sent Status"
              v={selectedRoomLoader.sentStatus.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
            />
            <KeyValue
              k="Due Status"
              v={
                selectedRoomLoader.dueStatus
                  ? selectedRoomLoader.dueStatus.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
                  : 'N/A'
              }
            />
          </div>

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
                    Pet {petIndex + 1}: {displayPatient.name || 'Unknown Pet'}
                  </h3>
                </div>

                {/* Appointment Information */}
                <div
                  style={{
                    marginBottom: '20px',
                    padding: '20px',
                    backgroundColor: '#e3f2fd',
                    borderRadius: '8px',
                    border: '2px solid #90caf9',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }}
                >
                  <h4 style={{ marginTop: 0, marginBottom: '20px', color: '#1565c0', fontSize: '18px', fontWeight: 600 }}>
                    Appointment Information
                  </h4>
                  {appointments.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {appointments.map((apt, aptIdx) => (
                        <div
                          key={apt.id || aptIdx}
                          style={{
                            padding: '18px',
                            backgroundColor: '#fff',
                            borderRadius: '6px',
                            border: '1px solid #b3d9ff',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                          }}
                        >
                          {appointments.length > 1 && (
                            <div
                              style={{
                                fontWeight: 600,
                                marginBottom: '15px',
                                color: '#1565c0',
                                fontSize: '16px',
                                paddingBottom: '10px',
                                borderBottom: '2px solid #90caf9',
                              }}
                            >
                              Appointment {aptIdx + 1}
                            </div>
                          )}
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                              gap: '15px',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <KeyValue k="Appointment ID" v={apt.id} />
                              <KeyValue k="PIMS ID" v={apt.pimsId || 'N/A'} />
                              <KeyValue k="Description" v={apt.description || 'N/A'} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <KeyValue k="Start" v={formatDateTime(apt.appointmentStart)} />
                              <KeyValue k="End" v={formatDateTime(apt.appointmentEnd)} />
                              <KeyValue k="Status" v={apt.statusName || 'N/A'} />
                              <KeyValue k="Confirm Status" v={apt.confirmStatusName || 'N/A'} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {apt.appointmentType && (
                                <KeyValue
                                  k="Type"
                                  v={apt.appointmentType.prettyName || apt.appointmentType.name || 'N/A'}
                                />
                              )}
                              {apt.primaryProvider && (
                                <KeyValue
                                  k="Provider"
                                  v={`${apt.primaryProvider.firstName || ''} ${apt.primaryProvider.lastName || ''}`.trim() || 'N/A'}
                                />
                              )}
                              {apt.instructions && <KeyValue k="Instructions" v={apt.instructions} />}
                              {apt.equipment && <KeyValue k="Equipment" v={apt.equipment} />}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: '#666', fontStyle: 'italic', padding: '20px', textAlign: 'center' }}>
                      No appointments found for this pet
                    </div>
                  )}
                </div>

                {/* Pet/Patient Information */}
                <div
                  style={{
                    marginBottom: '20px',
                    padding: '20px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '8px',
                    border: '2px solid #dee2e6',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }}
                >
                  <h4 style={{ marginTop: 0, marginBottom: '20px', color: '#495057', fontSize: '18px', fontWeight: 600 }}>
                    Pet Details
                  </h4>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: '20px',
                      padding: '15px',
                      backgroundColor: '#fff',
                      borderRadius: '6px',
                      border: '1px solid #e9ecef',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <KeyValue k="Patient ID" v={displayPatient.id} />
                      <KeyValue k="PIMS ID" v={displayPatient.pimsId || 'N/A'} />
                      <KeyValue k="Name" v={displayPatient.name || 'N/A'} />
                      <KeyValue k="Species" v={displayPatient.species || 'N/A'} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <KeyValue k="Breed" v={displayPatient.breed || 'N/A'} />
                      <KeyValue k="Color" v={displayPatient.color || 'N/A'} />
                      <KeyValue k="Weight" v={displayPatient.weight ? `${displayPatient.weight} lbs` : 'N/A'} />
                      <KeyValue k="DOB" v={formatDate(displayPatient.dob || null)} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <KeyValue k="Sex" v={displayPatient.sex || 'N/A'} />
                      {displayPatient.alerts && <KeyValue k="Alerts" v={displayPatient.alerts} />}
                      {displayPatient.primaryProvider && (
                        <KeyValue
                          k="Primary Provider"
                          v={`${displayPatient.primaryProvider.firstName || ''} ${displayPatient.primaryProvider.lastName || ''}`.trim() || 'N/A'}
                        />
                      )}
                    </div>
                  </div>
                </div>


                {/* Client Name */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ marginBottom: '10px', color: '#555' }}>Client Name</h4>
                  <div style={{ padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd' }}>
                    {client ? (
                      <div>
                        <strong>{client.firstName} {client.lastName}</strong>
                        {client.email && <div style={{ marginTop: '5px', color: '#666' }}>Email: {client.email}</div>}
                        {client.phone1 && <div style={{ color: '#666' }}>Phone: {client.phone1}</div>}
                      </div>
                    ) : (
                      <div style={{ color: '#999' }}>No client information available</div>
                    )}
                  </div>
                </div>

                {/* Window of Arrival */}
                {firstAppt && (() => {
                  // Check if appointment type is FIXED (case-insensitive)
                  const appointmentTypeName = firstAppt.appointmentType?.name?.toUpperCase() || firstAppt.appointmentType?.prettyName?.toUpperCase() || '';
                  const isFixed = appointmentTypeName === 'FIXED';
                  
                  if (isFixed) {
                    // No arrival window for FIXED appointments
                    return null;
                  }
                  
                  // Calculate one hour before and one hour after start time
                  const startTime = DateTime.fromISO(firstAppt.appointmentStart);
                  const windowStart = startTime.minus({ hours: 1 });
                  const windowEnd = startTime.plus({ hours: 1 });
                  
                  return (
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={{ marginBottom: '10px', color: '#555' }}>Window of Arrival</h4>
                      <div style={{ padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd' }}>
                        {formatDateTime(windowStart.toISO())} - {formatDateTime(windowEnd.toISO())}
                      </div>
                    </div>
                  );
                })()}

                {/* Reason for Appointment */}
                {firstAppt && (
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ marginBottom: '10px', color: '#555' }}>Reason for Appointment</h4>
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
                          }}
                          placeholder="Enter reason for appointment..."
                          style={{
                            width: '100%',
                            minHeight: '80px',
                            padding: '12px',
                            fontSize: '14px',
                            border: '1px solid #ced4da',
                            borderRadius: '4px',
                            fontFamily: 'inherit',
                            resize: 'vertical',
                            boxSizing: 'border-box',
                          }}
                        />
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
                      Does this issue have anything to do with mobility?
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
                  </div>

                  {/* Lab Work Question */}
                  <div>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 500, color: '#333', fontSize: '16px' }}>
                      Would lab work help to diagnose the issue?
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
                  </div>
                </div>

                {/* Reminders */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ marginBottom: '15px', color: '#555' }}>
                    Reminders ({item.reminders?.length || 0} + {addedItems[patient.id]?.length || 0} added)
                  </h4>
                  
                  {/* Original Reminders */}
                  {item.reminders && item.reminders.length > 0 && (
                    <div style={{ marginBottom: '15px' }}>
                      {item.reminders.map((reminderWithPrice, reminderIdx) => {
                        const reminderId = reminderWithPrice.reminder.id || reminderIdx;
                        const feedbackKey = `reminder-${reminderId}`;
                        const feedbackStatus = reminderFeedback[feedbackKey];
                        const correction = reminderCorrections[feedbackKey];
                        const hasMatchedItem = reminderWithPrice.matchedItem?.name;

                        return (
                          <div
                            key={reminderId}
                            style={{
                              marginBottom: reminderIdx < item.reminders.length - 1 ? '15px' : 0,
                              padding: '15px',
                              backgroundColor: feedbackStatus === 'correct' ? '#e8f5e9' : feedbackStatus === 'incorrect' ? '#ffebee' : '#fafafa',
                              border: feedbackStatus === 'correct' ? '1px solid #4caf50' : feedbackStatus === 'incorrect' ? '1px solid #f44336' : '1px solid #e0e0e0',
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
                                  </div>
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
                                {feedbackStatus === 'correct' && (
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
                              <div style={{ marginLeft: '15px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', minWidth: '150px' }}>
                                {/* Quantity Field */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                                <div style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32' }}>
                                  ${(() => {
                                    // Get the base price
                                    let basePrice = 0;
                                    if (correction?.selectedItem?.price != null) {
                                      basePrice = Number(correction.selectedItem.price);
                                    } else if (reminderWithPrice.price != null) {
                                      basePrice = Number(reminderWithPrice.price);
                                    }
                                    // Multiply by quantity
                                    const quantity = reminderQuantities[reminderId] || 1;
                                    return (basePrice * quantity).toFixed(2);
                                  })()}
                                </div>
                              </div>
                            </div>

                            {/* Feedback Buttons - Only show for reminders with matches */}
                            {hasMatchedItem && !feedbackStatus && (
                              <div style={{ marginTop: '15px', display: 'flex', gap: '10px', paddingTop: '15px', borderTop: '1px solid #e0e0e0' }}>
                                <button
                                  onClick={() => handleReminderFeedback(reminderId, reminderWithPrice.reminder.description, true, reminderWithPrice)}
                                  disabled={feedbackStatus === 'correcting'}
                                  style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#4caf50',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: feedbackStatus === 'correcting' ? 'not-allowed' : 'pointer',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    opacity: feedbackStatus === 'correcting' ? 0.6 : 1,
                                  }}
                                >
                                  ✓ Correct Match
                                </button>
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
                                  ✗ Incorrect Match
                                </button>
                              </div>
                            )}

                            {/* Search for Match - Show for reminders without matches */}
                            {!hasMatchedItem && !feedbackStatus && (
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
                                          // Select the item (don't submit yet)
                                          // Clear the search query and results after selection to stop any pending searches
                                          setReminderCorrections((prev) => ({
                                            ...prev,
                                            [feedbackKey]: { searchQuery: '', results: [], loading: false, selectedItem: result },
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
                                        // Submit as correct match with the selected item
                                        handleReminderFeedback(reminderId, reminderWithPrice.reminder.description, true, reminderWithPrice, correction.selectedItem!);
                                        // Clear the search query and results after submission, but keep selectedItem for price display
                                        setReminderCorrections((prev) => ({
                                          ...prev,
                                          [feedbackKey]: { searchQuery: '', results: [], loading: false, selectedItem: correction.selectedItem },
                                        }));
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
                                      ✓ Correct Match
                                    </button>
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
                            {feedbackStatus === 'correcting' && (
                              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0' }}>
                                <div style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 500, color: '#333' }}>
                                  Search for the correct item:
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
                                      onClick={() => handleSubmitCorrection(reminderId, reminderWithPrice.reminder.description, correction.selectedItem!, reminderWithPrice)}
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
                                      Submit Correction
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
                              top: '10px',
                              right: '10px',
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
                            </div>
                            <div style={{ marginLeft: '15px', textAlign: 'right', minWidth: '100px' }}>
                              <div style={{ fontSize: '20px', fontWeight: 700, color: '#2e7d32' }}>
                                ${item.price != null ? Number(item.price).toFixed(2) : '0.00'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Total */}
                  {((item.reminders && item.reminders.length > 0) || (addedItems[patient.id] && addedItems[patient.id].length > 0)) && (
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
                        (item.reminders?.reduce((sum, r) => {
                          // For reminders with selected/corrected items, use selected item price
                          const reminderId = r.reminder.id;
                          const correctionKey = `reminder-${reminderId}`;
                          const correction = reminderCorrections[correctionKey];
                          // Get the base price
                          let basePrice = 0;
                          if (correction?.selectedItem?.price != null) {
                            basePrice = Number(correction.selectedItem.price);
                          } else if (r.price != null) {
                            basePrice = Number(r.price);
                          }
                          // Multiply by quantity
                          const quantity = reminderQuantities[reminderId] || 1;
                          return sum + (basePrice * quantity);
                        }, 0) || 0) +
                        (addedItems[patient.id]?.reduce((sum, item) => sum + (item.price != null ? Number(item.price) : 0), 0) || 0)
                      ).toFixed(2)}
                      </div>
                    </div>
                  )}

                  {/* Search Box */}
                  <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                    <h5 style={{ marginTop: 0, marginBottom: '10px', color: '#495057', fontSize: '16px', fontWeight: 600 }}>
                      Add Item
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

                  {/* Vaccine Checkboxes */}
                  <div style={{ marginTop: '20px', marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                    <h5 style={{ marginTop: 0, marginBottom: '15px', color: '#495057', fontSize: '16px', fontWeight: 600 }}>
                      Vaccines
                    </h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {(() => {
                        const checkboxes = vaccineCheckboxes[patient.id] || { felv: true, lepto: true, lyme: true, bordatella: true, sharps: true };
                        const declinedItems = selectedRoomLoader?.declinedInventoryItems || [];
                        
                        // Calculate sharps based on any vaccine being checked
                        const anyVaccineChecked = checkboxes.felv || checkboxes.lepto || checkboxes.lyme || checkboxes.bordatella;
                        const sharpsChecked = checkboxes.sharps !== undefined ? checkboxes.sharps : anyVaccineChecked;
                        
                        // Helper function to check if an item name matches a vaccine
                        const isDeclined = (vaccineName: string) => {
                          return declinedItems.some((item) => {
                            const itemName = (item.name || '').toLowerCase();
                            const searchTerms: string[] = [];
                            
                            if (vaccineName === 'felv') {
                              searchTerms.push('felv', 'feline leukemia', 'feline leukemia virus');
                            } else if (vaccineName === 'lepto') {
                              searchTerms.push('lepto', 'leptospirosis');
                            } else if (vaccineName === 'lyme') {
                              searchTerms.push('lyme', 'lyme disease');
                            } else if (vaccineName === 'bordatella') {
                              searchTerms.push('bordatella', 'bordetella', 'kennel cough');
                            }
                            
                            return searchTerms.some((term) => itemName.includes(term));
                          });
                        };

                        const felvDeclined = isDeclined('felv');
                        const leptoDeclined = isDeclined('lepto');
                        const lymeDeclined = isDeclined('lyme');
                        const bordatellaDeclined = isDeclined('bordatella');

                        return (
                          <>
                            {/* FeLV - Cats only */}
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
                              <input
                                type="checkbox"
                                checked={checkboxes.felv}
                                onChange={(e) => {
                                  const newFelv = e.target.checked;
                                  setVaccineCheckboxes((prev) => {
                                    const current = prev[patient.id] || { felv: true, lepto: true, lyme: true, bordatella: true, sharps: true };
                                    const updated = { ...current, felv: newFelv };
                                    // Auto-check sharps if any vaccine is checked
                                    updated.sharps = updated.felv || updated.lepto || updated.lyme || updated.bordatella;
                                    return { ...prev, [patient.id]: updated };
                                  });
                                }}
                                style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                              />
                              <span style={{ fontSize: '14px', color: '#333' }}>FeLV (Cats only)</span>
                              {felvDeclined && (
                                <span style={{ fontSize: '12px', color: '#dc3545', fontWeight: 500, marginLeft: '8px' }}>
                                  Previously declined
                                </span>
                              )}
                            </label>

                            {/* Lepto - Dogs only */}
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
                              <input
                                type="checkbox"
                                checked={checkboxes.lepto}
                                onChange={(e) => {
                                  const newLepto = e.target.checked;
                                  setVaccineCheckboxes((prev) => {
                                    const current = prev[patient.id] || { felv: true, lepto: true, lyme: true, bordatella: true, sharps: true };
                                    const updated = { ...current, lepto: newLepto };
                                    // Auto-check sharps if any vaccine is checked
                                    updated.sharps = updated.felv || updated.lepto || updated.lyme || updated.bordatella;
                                    return { ...prev, [patient.id]: updated };
                                  });
                                }}
                                style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                              />
                              <span style={{ fontSize: '14px', color: '#333' }}>Lepto (Dogs only)</span>
                              {leptoDeclined && (
                                <span style={{ fontSize: '12px', color: '#dc3545', fontWeight: 500, marginLeft: '8px' }}>
                                  Previously declined
                                </span>
                              )}
                            </label>

                            {/* Lyme - Dog only */}
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
                              <input
                                type="checkbox"
                                checked={checkboxes.lyme}
                                onChange={(e) => {
                                  const newLyme = e.target.checked;
                                  setVaccineCheckboxes((prev) => {
                                    const current = prev[patient.id] || { felv: true, lepto: true, lyme: true, bordatella: true, sharps: true };
                                    const updated = { ...current, lyme: newLyme };
                                    // Auto-check sharps if any vaccine is checked
                                    updated.sharps = updated.felv || updated.lepto || updated.lyme || updated.bordatella;
                                    return { ...prev, [patient.id]: updated };
                                  });
                                }}
                                style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                              />
                              <span style={{ fontSize: '14px', color: '#333' }}>Lyme (Dog only)</span>
                              {lymeDeclined && (
                                <span style={{ fontSize: '12px', color: '#dc3545', fontWeight: 500, marginLeft: '8px' }}>
                                  Previously declined
                                </span>
                              )}
                            </label>

                            {/* Bordatella - Dogs only */}
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
                              <input
                                type="checkbox"
                                checked={checkboxes.bordatella}
                                onChange={(e) => {
                                  const newBordatella = e.target.checked;
                                  setVaccineCheckboxes((prev) => {
                                    const current = prev[patient.id] || { felv: true, lepto: true, lyme: true, bordatella: true, sharps: true };
                                    const updated = { ...current, bordatella: newBordatella };
                                    // Auto-check sharps if any vaccine is checked
                                    updated.sharps = updated.felv || updated.lepto || updated.lyme || updated.bordatella;
                                    return { ...prev, [patient.id]: updated };
                                  });
                                }}
                                style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                              />
                              <span style={{ fontSize: '14px', color: '#333' }}>Bordatella (Dogs only)</span>
                              {bordatellaDeclined && (
                                <span style={{ fontSize: '12px', color: '#dc3545', fontWeight: 500, marginLeft: '8px' }}>
                                  Previously declined
                                </span>
                              )}
                            </label>

                            {/* Sharps Checkbox */}
                            <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #dee2e6' }}>
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
                                <span style={{ fontSize: '14px', color: '#333', fontWeight: 500 }}>Sharps</span>
                              </label>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
          )}

          {/* Send to Client Button */}
          {selectedRoomLoader && (
            <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '2px solid #ddd', display: 'flex', justifyContent: 'flex-end' }}>
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
    </div>
  );
}

