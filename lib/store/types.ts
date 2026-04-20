
export type CalendarEvent = {
  id: string;
  source: string;
  client: string;
  eventName: string;
  venue: string;
  venueAddress?: string;
  city?: string;
  state?: string;
  cityState: string;
  googleMapsLink?: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  notes: string;
  status: string;
  lead?: string;
  hands?: string;
};

export type QuoteLine = {
  serviceKey: string;
  qty: number;
  hours: number;
  holidayHours: number;
  travel: number;
  baseHourly: number;
  baseDay: number;
  otRate: number;
  dtRate: number;
  rule: string;
  total: number;
  // Discrete UI columns (populated from quote_lines / invoice_lines table)
  department?: string;
  specialty?: string;
  shiftLabel?: string;
  quoteDate?: string;
  startTime?: string;
  endTime?: string;
  rateMode?: string;
};

export type TimeEntry = {
  id: string;
  position: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  timeIn1: string;
  timeOut1: string;
  lunchMinutes: number;
  timeIn2: string;
  timeOut2: string;
  stdHours: number;
  otHours: number;
  dtHours: number;
  totalHours: number;
  stdRate: number;
  otRate: number;
  dtRate: number;
  totalPay: number;
  employeeKey?: string | null; // links to employees table
  userId?: string | null;      // set for staff-submitted entries
  status?: string | null;      // null=admin-created, submitted|approved|rejected for staff entries
  sortOrder?: number;
};

export type Timesheet = {
  id: string;
  jobSheetId: string;
  title: string;
  hidePayColumns: boolean;
  rows: TimeEntry[];
};

export type QuoteDraft = {
  id: string;
  client: string;
  eventName: string;
  venue: string;
  cityState: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  expectedHoursPerDay?: number;
  total: number;
  deposit: number;
  status: string;
  notes: string;
  lines: QuoteLine[];
  terms: string;
  linkedJobRequestId?: string;
  linkedJobSheetId?: string;
  timesheetSummary?: Array<{ position: string; workers: number; stdHours: number; otHours: number; dtHours: number; totalHours: number; totalPay: number; }>;
  signatureName?: string;
  signedAt?: string;
  rateCardProfileId?: string;
};

export type InvoiceDraft = {
  id: string;
  quoteId: string;
  invoiceNo: string;
  issueDate: string;
  dueDate: string;
  poNo: string;
  billTo: string;
  client: string;
  eventName: string;
  venue: string;
  cityState: string;
  lines: QuoteLine[];
  subtotal: number;
  deposit: number;
  amountDue: number;
  terms: string;
  notes: string;
  status: string;
  paidAmount: number;
  rateCardProfileId?: string;
  linkedJobSheetId?: string;
  timesheetSummary?: Array<{ position: string; workers: number; stdHours: number; otHours: number; dtHours: number; totalHours: number; totalPay: number; }>;
};

export type JobRequest = {
  id: string;
  client: string;
  eventName: string;
  venue: string;
  venueAddress: string;
  city: string;
  state: string;
  cityState: string;
  googleMapsLink: string;
  requestDate: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  expectedHours?: number;
  addToCalendar?: boolean;
  status: string;
  notes: string;
  attachmentNames: string[];
  packetNotes: string;
};

export type JobSheetWorker = {
  employeeKey: string;
  fullName: string;
  firstName: string;
  lastName: string;
  stateCode: string;
  phone: string;
  email: string;
  role: string;
  confirmed: boolean;
};

export type JobSheet = {
  id: string;
  sourceEventId?: string;
  title: string;
  client: string;
  eventName: string;
  venue: string;
  venueAddress?: string;
  city?: string;
  state?: string;
  cityState: string;
  googleMapsLink?: string;
  date: string;
  callTime: string;
  notes: string;
  attachmentNames: string[];
  workers: JobSheetWorker[];
};

export type EmployeeDocument = {
  id: string;
  name: string;
  dataUrl?: string;
};

export type EmployeeRecord = {
  employeeKey: string;
  employeeId?: string;
  fullName: string;
  firstName: string;
  lastName: string;
  payrollName?: string;
  preferredName?: string;
  status?: string;
  workerCategory?: string;
  positionStatus?: string;
  employmentType?: string;
  type: "staff" | "contractor";  // staff = internal employee; contractor = labor pool
  city?: string;
  state?: string;
  stateCode?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  profilePicture?: string;
  documents?: EmployeeDocument[];
  source?: string;
};


export type Client = {
  id: string;
  name: string;
  contactName?: string;
  billTo?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
  isActive: boolean;
};

export type Position = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type Specialty = {
  id: string;
  positionId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type Profile = {
  id: string;          // matches auth.users.id (uuid)
  role: string;        // "admin" | "staff" | "crew_leader"
  employeeKey: string | null;
  fullName: string;
  email: string;
  // contact info (phone, address, city, state) lives on the employee record
};

export type UserWithProfile = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  profile: Profile | null;
};

export type JobCostingLine = {
  id: string;
  role: string;
  payRate: number;
  crewCount: number;
  stHours: number;
  otHours: number;
  dtHours: number;
  stRate: number;
  otRate: number;
  dtRate: number;
  quotedExpenses: number;
  actualPayRate: number;
  actualCrewCount: number;
  actualSTHours: number;
  actualOTHours: number;
  actualDTHours: number;
  actualExpenses: number;
  targetMargin: number;
  billMode?: "hourly" | "day";
  quotedBaseDay?: number;
  quotedOtTrigger?: number;
  manualRateOverride?: boolean;
  manualOtOverride?: boolean;
  manualDtOverride?: boolean;
};

export type QuoteDraftWorkspace = {
  id: string;
  name: string;
  updatedAt: string;
  data: any;
};

export type JobCostingDraft = {
  id: string;
  title: string;
  client: string;
  eventName: string;
  venue: string;
  cityState: string;
  linkedJobRequestId?: string;
  linkedQuoteId?: string;
  linkedJobSheetId?: string;
  linkedTimesheetId?: string;
  linkedRateCardProfileId?: string;
  payrollBurden: number;
  overheadPerHour: number;
  targetMargin: number;
  otPayMultiplier: number;
  dtPayMultiplier: number;
  otBillMultiplier: number;
  dtBillMultiplier: number;
  minimumHours: number;
  billedExpenses: number;
  rentals: number;
  passThroughMarkupRevenue: number;
  actualTravel: number;
  actualHotels: number;
  actualPerDiem: number;
  actualEquipment: number;
  actualOtherCosts: number;
  actualRevenueCollected: number;
  estimatedJobCost: number;
  lines: JobCostingLine[];
  createdAt: string;
  updatedAt: string;
};
