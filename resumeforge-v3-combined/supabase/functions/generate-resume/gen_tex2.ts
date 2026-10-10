import { buildLatex } from "./latex/build-latex.ts";
import { getATSProfile } from "./ats-profiles/generic.ts";

// Stress-test fixture: long text, special LaTeX-hostile characters,
// multiple entries per section, to catch real overflow/escaping bugs.
const resume = {
  name: "Alexandra Q. O'Brien-Fitzgerald & Associates",
  contact: "alexandra@example.com | +1 (555) 123-4567 | San Francisco, CA | linkedin.com/in/example & github.com/example",
  summary: "Senior Software Engineer with 8+ years building distributed systems handling $2.5M+ in daily transactions, 99.99% uptime SLAs & cross-functional leadership across 5+ teams. Expert in C++, C#, and 100% test coverage practices; reduced latency by 45% & cut costs 30%.",
  experience: [
    {
      title: "Staff Software Engineer — Platform & Infrastructure Team",
      company: "MegaCorp Technologies, Inc. (NASDAQ: MCT) — R&D Division #4",
      dates: "Jan 2021 - Present",
      location: "San Francisco, CA (Hybrid, 50% remote)",
      bullets: [
        "Architected a microservices platform processing 500K+ requests/sec, reducing p99 latency by 45% while cutting infrastructure costs by $1.2M annually (30% reduction) — used Kubernetes, Go & gRPC across 40+ services",
        "Led a cross-functional team of 12 engineers (60% new hires) to deliver a real-time analytics pipeline with 99.99% uptime, processing 10TB+/day of clickstream data using Kafka, Flink & Snowflake",
        "Mentored 8 junior/mid-level engineers; 100% promotion rate within 18 months for direct reports; introduced code review standards adopted company-wide (500+ engineers)",
        "Negotiated $3.5M vendor contract renewal, saving 22% vs. prior terms while adding SLA guarantees & 24/7 support tier",
        "Designed A/B testing framework used by 15+ product teams, driving a 12% lift in conversion & $8M incremental ARR"
      ]
    },
    {
      title: "Software Engineer II",
      company: "StartUp Labs LLC (formerly \"Beta Co.\" — acquired 2019)",
      dates: "Jun 2018 - Dec 2020",
      location: "Austin, TX",
      bullets: [
        "Built payment reconciliation system handling $50M+/month with 100% accuracy audit results across 3 currencies (USD, EUR, GBP)",
        "Reduced build times from 45min to 6min (87% improvement) via Bazel migration & remote caching, saving ~200 engineer-hours/week",
        "Owned on-call rotation for a 20-person team; authored runbooks that cut MTTR by 60% (from 2.5hrs to 1hr average)"
      ]
    }
  ],
  education: [
    { degree: "M.S. in Computer Science, Specialization: Distributed Systems & ML", school: "Stanford University", location: "Stanford, CA", dates: "2016 - 2018", details: "GPA: 3.9/4.0 — Teaching Assistant for CS 244B (Distributed Systems), 2 semesters" },
    { degree: "B.S. in Electrical Engineering & Computer Science (Double Major)", school: "UC Berkeley", location: "Berkeley, CA", dates: "2012 - 2016", details: "Summa Cum Laude, Tau Beta Pi Honor Society" }
  ],
  skills: {
    "Languages": ["Go", "Python", "C++", "TypeScript/JavaScript", "Rust", "Java", "SQL"],
    "Infrastructure & Cloud": ["Kubernetes", "AWS (EC2, S3, Lambda, RDS)", "Terraform", "Docker", "GCP", "Azure DevOps"],
    "Data & Messaging": ["Kafka", "Flink", "Snowflake", "PostgreSQL", "Redis", "Elasticsearch"],
    "Practices & Tools": ["CI/CD", "gRPC & Protocol Buffers", "System Design", "A/B Testing @ Scale", "OKRs & 20% time"]
  },
  projects: [
    { name: "OpenTrace — Distributed Tracing Tool (2.3k GitHub stars)", tech: "Go, OpenTelemetry, ClickHouse", link: "github.com/example/opentrace", bullets: ["Built a lightweight distributed tracing collector used by 200+ companies; 40% lower overhead than Jaeger", "Won \"Best Open Source Tool\" at DevOps Days 2022 (100+ submissions)"] }
  ],
  certifications: ["AWS Certified Solutions Architect – Professional (2023)", "Certified Kubernetes Administrator (CKA) #12345", "Six Sigma Green Belt — 95th percentile score"],
  improvements_made: []
};

const profile = getATSProfile("generic");

const formats: [string, string][] = [
  ["moderncv-classic", "04-moderncv-classic"],
  ["minimal-clean-tech", "09-minimal-clean-tech"],
  ["faang-style-compact", "10-faang-style-compact"],
  ["bold-header-modern", "12-bold-header-modern"],
  ["ultra-clean-one-page", "13-ultra-clean-one-page"],
  ["premium-minimalist", "14-premium-minimalist"],
  ["tech-focused-dense", "15-tech-focused-dense"],
  ["structured-executive-brief", "20-structured-executive-brief"],
];

for (const [fmt, slug] of formats) {
  // deno-lint-ignore no-explicit-any
  const tex = buildLatex(resume as any, fmt as any, profile);
  await Deno.writeTextFile(`/tmp/latexcheck/${slug}.tex`, tex);
}
console.log("wrote", formats.length, "tex files");
