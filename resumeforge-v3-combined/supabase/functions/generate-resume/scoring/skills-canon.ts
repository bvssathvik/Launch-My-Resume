// ─────────────────────────────────────────
// skills-canon.ts — Controlled canonical/acronym matching
//
// Plain substring or single-string matching means "Amazon Web Services"
// on a job post never matches "AWS" on a resume, and "JavaScript" never
// matches "JS". A real ATS keyword matcher canonicalizes well-known
// acronym/full-form pairs before comparing.
//
// This is intentionally a small, hand-curated, EXPLICIT list — not a
// general synonym/embedding model. Uncontrolled semantic matching (e.g.
// treating "data analysis" as equivalent to "Python") produces false
// matches no real ATS would give credit for. Every group below is an
// unambiguous acronym/full-form or well-known equivalent pair, so
// expanding a keyword to its group members can only add matches a
// reasonable human reviewer would also accept.
// ─────────────────────────────────────────

// Each inner array is a group of interchangeable surface forms.
// Matching expands a keyword to every other member of its group.
const CANONICAL_GROUPS: string[][] = [
  ["Amazon Web Services", "AWS"],
  ["Google Cloud Platform", "GCP", "Google Cloud"],
  ["Microsoft Azure", "Azure"],
  ["JavaScript", "JS"],
  ["TypeScript", "TS"],
  ["Node.js", "NodeJS", "Node"],
  ["React.js", "ReactJS", "React"],
  ["Vue.js", "VueJS", "Vue"],
  ["PostgreSQL", "Postgres"],
  ["MongoDB", "Mongo"],
  ["Kubernetes", "K8s"],
  ["Continuous Integration and Continuous Deployment", "CI/CD", "Continuous Integration/Continuous Deployment", "Continuous Integration and Continuous Delivery"],
  ["Machine Learning", "ML"],
  ["Artificial Intelligence", "AI"],
  ["Natural Language Processing", "NLP"],
  ["Deep Learning", "DL"],
  ["Application Programming Interface", "API"],
  ["User Interface", "UI"],
  ["User Experience", "UX"],
  ["Structured Query Language", "SQL"],
  ["Object-Oriented Programming", "OOP"],
  ["Representational State Transfer", "REST", "RESTful"],
  ["Extract, Transform, Load", "ETL"],
  ["Software Development Kit", "SDK"],
  ["Command Line Interface", "CLI"],
  ["Infrastructure as Code", "IaC"],
  ["Identity and Access Management", "IAM"],
  ["Virtual Private Cloud", "VPC"],
  ["Elastic Compute Cloud", "EC2"],
  ["Simple Storage Service", "S3"],
  ["Relational Database Management System", "RDBMS"],
  ["Customer Relationship Management", "CRM"],
  ["Enterprise Resource Planning", "ERP"],
  ["Microsoft Excel", "Excel", "MS Excel"],
  ["Microsoft Office", "MS Office"],
  ["Search Engine Optimization", "SEO"],
  ["Search Engine Marketing", "SEM"],
  ["Key Performance Indicator", "KPI"],
  ["Return on Investment", "ROI"],
  ["Quality Assurance", "QA"],
  ["Test-Driven Development", "TDD"],
  ["Continuous Integration", "CI"],
  ["Version Control System", "VCS"],
  [".NET", "DotNet", "Dot Net"],
  ["C#", "CSharp", "C Sharp"],
  ["C++", "CPlusPlus", "C Plus Plus"],
  ["Golang", "Go"],
  ["Objective-C", "ObjC"],
  ["Power BI", "PowerBI"],
  ["Amazon Redshift", "Redshift"],
  ["Google Analytics", "GA"],
  ["Project Management Professional", "PMP"],
  ["Bachelor of Technology", "B.Tech", "BTech", "Bachelor's in Technology"],
  ["Bachelor of Engineering", "B.E.", "BE"],
  ["Bachelor of Science", "B.Sc", "BSc"],
  ["Master of Technology", "M.Tech", "MTech"],
  ["Master of Science", "M.Sc", "MSc"],
  ["Master of Business Administration", "MBA"],
];

// keyword (lowercased) -> canonical group index, built once at module load.
const LOOKUP: Map<string, number> = new Map();
CANONICAL_GROUPS.forEach((group, idx) => {
  group.forEach((term) => LOOKUP.set(term.toLowerCase(), idx));
});

/**
 * Returns every known equivalent surface form for a keyword (including
 * the keyword itself). If the keyword isn't in the controlled dictionary,
 * returns just the keyword unchanged — no guessing, no fuzzy fallback.
 */
export function expandCanonical(keyword: string): string[] {
  const key = keyword.trim().toLowerCase();
  const groupIdx = LOOKUP.get(key);
  if (groupIdx === undefined) return [keyword];
  return CANONICAL_GROUPS[groupIdx];
}

// A short, explicit list of generic filler phrases that carry no signal
// for ATS keyword matching and should be flagged as content-quality
// warnings rather than scored as achievements.
export const BUZZWORDS: string[] = [
  "hard worker",
  "team player",
  "go-getter",
  "results-driven",
  "results driven",
  "passionate professional",
  "detail-oriented",
  "detail oriented",
  "self-starter",
  "self starter",
  "think outside the box",
  "synergy",
  "fast-paced environment",
  "dynamic environment",
  "proven track record",
  "excellent communication skills",
  "highly motivated",
  "hardworking",
];

// Small, explicit set of strong resume action verbs used only as a
// fallback when a job's Pass-1 keyword extraction returns no
// `action_verbs`. Not exhaustive by design — this is a floor, not a
// grading rubric.
export const GENERIC_ACTION_VERBS: string[] = [
  "led", "built", "designed", "developed", "implemented", "created",
  "launched", "managed", "architected", "engineered", "optimized",
  "improved", "reduced", "increased", "automated", "delivered",
  "drove", "spearheaded", "established", "streamlined", "deployed",
  "scaled", "migrated", "analyzed", "resolved", "mentored", "coordinated",
  "initiated", "authored", "presented", "negotiated", "researched",
];
