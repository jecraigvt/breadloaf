export interface GoldenExpectedDocument {
  documentId: string;
  title: string;
}

export interface GoldenQuestion {
  id: string;
  question: string;
  expectedDocuments: GoldenExpectedDocument[];
}

// Add every future family-reported retrieval miss here. Empty expectedDocuments
// marks a negative control; controls are scored in the same denominator.
export const ARCHIVE_GOLDEN_QUESTIONS: GoldenQuestion[] = [
  {
    id: "ancestry-photos",
    question: "pictures of people in our ancestry",
    expectedDocuments: [
      { documentId: "cms9nse0m000spn45ltfgt410", title: "Bestor Photos 170" },
    ],
  },
  {
    id: "bylaws-succession",
    question: "what do the bylaws say about succession",
    expectedDocuments: [
      {
        documentId: "cmrgfq7f3002gp545pcx1drkq",
        title: "Breadloaf Hill Corporation Bylaws",
      },
    ],
  },
  {
    id: "property-vision",
    question: "what is our vision for the property",
    expectedDocuments: [
      { documentId: "cmrgfq72e0029p545f8py4en0", title: "Breadloaf Hill Vision" },
    ],
  },
  {
    id: "inheritance",
    question: "how does inheritance work here",
    expectedDocuments: [
      {
        documentId: "cmrgfq78n002dp545cn591tc8",
        title: "History of the Inheritance Section (2013)",
      },
    ],
  },
  {
    id: "board-meeting-date",
    question: "when is the board meeting",
    expectedDocuments: [
      {
        documentId: "cmrbje1jx0001pc472t1f5b1n",
        title: "2025 Annual Board Meeting Minutes",
      },
    ],
  },
  {
    id: "meadow-mowing",
    question: "who mowed the meadow",
    expectedDocuments: [
      {
        documentId: "cms8zhngk000opn45nn91shmi",
        title: "Voice Memo Jul 31 at 934 AM",
      },
    ],
  },
  {
    id: "heater-ignition",
    question: "the heater will not ignite",
    expectedDocuments: [
      {
        documentId: "cmrwijshx000hmm44gf1irv8d",
        title: "Archived Photo (2026-07-22) — Weil-McLain boiler",
      },
    ],
  },
  {
    id: "nonsense-control",
    question: "purple monkey dishwasher",
    expectedDocuments: [],
  },
  {
    id: "succession-amendment",
    question: "what change was proposed to the succession rules",
    expectedDocuments: [
      {
        documentId: "cmrgfq6w30026p5459azra5ya",
        title: "Proposed Amendment to the Succession Clause",
      },
    ],
  },
  {
    id: "letter-to-sons",
    question: "what instructions did Dad leave for his four sons",
    expectedDocuments: [
      {
        documentId: "cmrgfq6pw0024p5458jvxs9t4",
        title: "Instruction Letter to Brothers",
      },
    ],
  },
  {
    id: "maintenance-due",
    question: "what property maintenance is due this year",
    expectedDocuments: [
      {
        documentId: "cmrgfiu8i001up545tkxksgc1",
        title: "Breadloaf Maintenance Schedule",
      },
    ],
  },
  {
    id: "maintenance-history",
    question: "what maintenance work has already been completed",
    expectedDocuments: [
      {
        documentId: "cmrgfitml001rp545lr1hogud",
        title: "Breadloaf Maintenance Log",
      },
    ],
  },
  {
    id: "family-assessment",
    question: "how much was the annual family assessment set at in 2024",
    expectedDocuments: [
      {
        documentId: "cmrgfhtt70010p545gdb17u72",
        title: "Board Meeting Minutes and Agenda - July 13, 2024",
      },
    ],
  },
  {
    id: "mortgage-balance",
    question: "what was the outstanding mortgage balance in July 2025",
    expectedDocuments: [
      {
        documentId: "cmrgffrj6000dp545glq00xz5",
        title: "Board Meeting Minutes - July 19, 2025",
      },
    ],
  },
  {
    id: "town-taxes",
    question: "how much were the estimated town taxes for 2026",
    expectedDocuments: [
      {
        documentId: "cmrbje8tp0004pc47wrbc1z2x",
        title: "Agenda for 2026 Annual BLH Inc. Corporate Meeting",
      },
    ],
  },
  {
    id: "winter-checkout",
    question: "when we leave for winter, what temperature should the thermostats be set to and should the red gas switch stay on",
    expectedDocuments: [
      {
        documentId: "cmrgfg7jl000mp5451wyzf3pb",
        title: "Breadloaf Cabin Check-Out List",
      },
    ],
  },
  {
    id: "backup-power",
    question: "how do I connect backup power at the basement electrical panel",
    expectedDocuments: [
      {
        documentId: "cmrgfi9pz0013p5453nt8duzv",
        title: "Emergency Generator Operating Instructions",
      },
    ],
  },
  {
    id: "low-water-pressure",
    question: "what should I check first when the water pressure gets low",
    expectedDocuments: [
      {
        documentId: "cmrtsr12m0001p445503wwszy",
        title: "Basement Water Pump Filter Maintenance Instruction",
      },
    ],
  },
  {
    id: "annex-voltage",
    question: "why are two outlets in the annex running at 240 volts",
    expectedDocuments: [
      {
        documentId: "cmrurysmy0008mm44p16kei54",
        title: "Electrician To-Do List for Annex 240-Volt Outlets",
      },
    ],
  },
  {
    id: "roof-wind-damage",
    question: "who helped repair the southeast corner of the roof after the March 2026 wind damage",
    expectedDocuments: [
      { documentId: "cmrurr4s60004mm44s2jx8ljp", title: "Voice Memo Jul 21 1031 AM" },
    ],
  },
  {
    id: "room-beds",
    question: "which upstairs room has a king bed and which spaces have twin beds",
    expectedDocuments: [
      {
        documentId: "cmrgffde40005p545iz5e1rcp",
        title: "Breadloaf Hill Room Descriptions and Bedding Inventory",
      },
    ],
  },
  {
    id: "rental-break-even",
    question: "how many nights at $400 would cover sixteen thousand dollars in annual costs",
    expectedDocuments: [
      {
        documentId: "cmrgfg52h000jp5456ha7ott0",
        title: "Rental Market Analysis and Revenue Projections",
      },
    ],
  },
  {
    id: "annex-moisture",
    question: "what moisture-control work was planned for the annex floors before the 2022 reunion",
    expectedDocuments: [
      {
        documentId: "cmrl0e0yq000vrz45c8r7imsr",
        title: "Construction Committee Annex Improvement Proposal",
      },
    ],
  },
  {
    id: "compost-rules",
    question: "can dairy products or greasy pizza boxes go in the compost drop-off",
    expectedDocuments: [
      {
        documentId: "cms6joz9l0004pn45zjuuy2nw",
        title: "Archived Photo (2026-07-29) — compost instructions",
      },
    ],
  },
  {
    id: "absent-pool-control",
    question: "where is the swimming pool pump shutoff",
    expectedDocuments: [],
  },
];
