// ─── Shared application constants ────────────────────────────────────────────
// Single source of truth for controlled-vocabulary fields used across
// multiple components. Import from here rather than defining inline.

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export const JOB_REQUEST_STATUSES = [
  { value: "lead",   label: "Lead"   },
  { value: "quoted", label: "Quoted" },
  { value: "booked", label: "Booked" },
  { value: "lost",   label: "Lost"   },
] as const;

export type JobRequestStatus = typeof JOB_REQUEST_STATUSES[number]["value"];
