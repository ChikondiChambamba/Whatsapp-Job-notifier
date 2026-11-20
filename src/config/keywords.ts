export type SignalCategory =
  | 'techRole'
  | 'techSkill'
  | 'civilRole'
  | 'civilSkill'
  | 'hiringVerb'
  | 'applyInstruction'
  | 'negative';

export interface SignalRule {
  category: SignalCategory;
  weight: number;
  patterns: RegExp[];
}

export const SIGNAL_RULES: SignalRule[] = [
  {
    category: 'techRole',
    weight: 2,
    patterns: [
      /\bsoftware (engineer|developer)\b/i,
      /\b(web|mobile|frontend|front-end|backend|back-end|fullstack|full-stack) (developer|engineer)\b/i,
      /\b(programmer|devops engineer|cloud engineer|network engineer|site reliability engineer)\b/i,
      /\b(data scientist|data engineer|data analyst|machine learning engineer|ai engineer)\b/i,
      /\b(system administrator|systems engineer|systems analyst|database administrator)\b/i,
      /\b(cyber ?security|information security|security analyst|soc analyst)\b/i,
      /\b(qa engineer|quality assurance engineer|test automation engineer)\b/i,
      /\b(it|ict) (support|officer|intern|assistant|technician|specialist|analyst|manager)\b/i,
      /\b(technical support|helpdesk|help desk|computer technician)\b/i,
      /\b(degree|diploma|certificate) in (computer science|software engineering|information technology)\b/i,
      /\b(computer science|software engineering) (graduate trainee|student|intern)\b/i,
      /\bsoftware intern\b/i,
    ],
  },
  {
    category: 'techSkill',
    weight: 1,
    patterns: [
      /\b(javascript|typescript|node\.?js|react|next\.?js|vue|angular)\b/i,
      /\b(python|django|flask|fastapi|java|spring boot|c#|\.net|php|laravel)\b/i,
      /\b(sql|mysql|postgresql|mssql|sqlite|mongodb)\b/i,
      /\b(aws|azure|google cloud|gcp|docker|kubernetes|linux|git)\b/i,
      /\b(power bi|tableau|data visuali[sz]ation|machine learning|artificial intelligence)\b/i,
      /\b(ccna|comptia|active directory|windows server)\b/i,
    ],
  },
  {
    category: 'civilRole',
    weight: 2,
    patterns: [
      /\bcivil engineer(ing)?\b/i,
      /\bstructural engineer(ing)?\b/i,
      /\b(site|construction|project) engineer\b/i,
      /\bquantity surveyor\b/i,
      /\b(road|highway|water|irrigation|geotechnical|hydraulic) engineer(ing)?\b/i,
      /\bconstruction (manager|supervisor)\b/i,
      /\bsite (supervisor|agent|foreman)\b/i,
      /\b(land|building|quantity) surveyor\b/i,
      /\b(degree|diploma|certificate) in (civil engineering|structural engineering|construction management|quantity surveying)\b/i,
      /\bcivil engineering (graduate|student|intern)\b/i,
    ],
  },
  {
    category: 'civilSkill',
    weight: 1,
    patterns: [
      /\b(autocad|civil 3d|revit|staad ?pro|arcgis)\b/i,
      /\b(structural design|reinforced concrete|geotechnical|hydrology|hydraulics)\b/i,
      /\bconstruction management\b/i,
      /\b(bill of quantities|boq)\b/i,
      /\b(land survey|topographic survey|total station)\b/i,
      /\b(road construction|building construction|concrete works)\b/i,
    ],
  },
  {
    category: 'hiringVerb',
    weight: 2,
    patterns: [
      /\b(hiring|now hiring|we are hiring|we're hiring)\b/i,
      /\b(vacancy|job opening|job opportunity|career opportunity|job posting|job listing)\b/i,
      /\b(recruiting|recruitment|join our team)\b/i,
      /\bwe(?:'re| are) looking for\b/i,
    ],
  },
  {
    category: 'applyInstruction',
    weight: 1,
    patterns: [
      /\bapply (now|online|via|by|before|through)\b/i,
      /\bsend (your )?(cv|resume)\b/i,
      /\b(email|submit|forward) (your )?(cv|resume|application)\b/i,
      /\bapplications? (close|closing|due)\b/i,
    ],
  },
  {
    category: 'negative',
    weight: -3,
    patterns: [
      /\bi(?:'| am|`m|m) looking for (a )?(job|work|vacancy)\b/i,
      /\bany(?:one)? hiring\??\b/i,
      /\bi need a job\b/i,
      /\bcan (anyone|somebody) help me find\b/i,
      /\bplease help me (find|get) (a )?(job|work)\b/i,
      // Individual role patterns (not one big alternation) so the engine
      // can count how many distinct non-target roles a message mentions.
      /\bsales\b/i,
      /\bmarketing\b/i,
      /\bdriver\b/i,
      /\bcleaner\b/i,
      /\b(waiter|waitress)\b/i,
      /\bchef\b/i,
      /\bnurse\b/i,
      /\bteacher\b/i,
      /\baccountant\b/i,
      /\b(receptionist|cashier|clerk|secretary)\b/i,
      /\b(auditor|procurement officer)\b/i,
      /\b(human resources|hr officer|hr assistant)\b/i,
      /\bfinance officer\b/i,
      /\b(store ?keeper|stores officer)\b/i,
      /\bsecurity guard\b/i,
      /\b(electrician|plumber|mechanic)\b/i,
      /\b(loan officer|credit officer|bank teller|branch manager)\b/i,
      /\b(pharmacist|laboratory technician|radiographer|clinical officer|midwife|matron)\b/i,
      /\bsocial worker\b/i,
      /\b(monitoring and evaluation|m&e) officer\b/i,
      /\blogistics officer\b/i,
      /\bwarehouse (assistant|clerk|supervisor)\b/i,
      /\b(farm|agricultural) (manager|officer|extension)\b/i,
      /\bbusiness development (officer|manager|executive)\b/i,
      /\boffice (assistant|administrator)\b/i,
      /\bpersonal assistant\b/i,
    ],
  },
];

// Renamed from REQUIRED_TECH_CATEGORIES now that civil engineering is a
// second target field — a message must hit at least one role/skill
// category from EITHER field to pass the gate.
export const REQUIRED_FIELD_CATEGORIES: SignalCategory[] = [
  'techRole',
  'techSkill',
  'civilRole',
  'civilSkill',
];

// If 3+ of these list-style markers appear AND multiple distinct
// non-target roles are named, the message is very likely a multi-vacancy
// blast post (e.g. "1. Driver 2. Civil Engineer 3. Cashier") rather than
// a single focused vacancy — see filterEngine's isLikelyBlast check.
export const LIST_MARKER_PATTERN = /(?:^|\n)\s*(?:\d{1,2}[.)]|[-•▪●])\s+\S/gm;
export const LIST_MARKER_BLAST_THRESHOLD = 3;