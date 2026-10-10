// ─────────────────────────────────────────
// Ultra-Clean One-Page
// The tightest, plainest template of the set: 0.5in margins, 10pt body,
// zero color, minimal 0.4pt rules, and near-zero list spacing so more
// content fits on a single page without ever feeling cramped-by-color.
// ─────────────────────────────────────────

export function ultraCleanOnePageTemplate(sections: {
  header: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  projects?: string;
  certifications?: string;
  additionalSections?: string;
}): string {
  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=0.5in]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}
\\usepackage[T1]{fontenc}

\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlist[itemize]{leftmargin=0.18in,itemsep=0.5pt,topsep=1pt,parsep=0pt}

\\titleformat{\\section}{\\bfseries}{}{0em}{}[\\rule{\\linewidth}{0.4pt}]
\\titlespacing{\\section}{0pt}{6pt}{2pt}

\\begin{document}

${sections.header}

${sections.summary ? `\\section{Summary}\n\\noindent ${sections.summary}\n` : ""}

${sections.education ? `\\section{Education}\n${sections.education}\n` : ""}

${sections.experience ? `\\section{Experience}\n${sections.experience}\n` : ""}

${sections.projects ? `\\section{Projects}\n${sections.projects}\n` : ""}

${sections.skills ? `\\section{Skills}\n${sections.skills}\n` : ""}

${sections.certifications ? `\\section{Certifications}\n${sections.certifications}\n` : ""}


${sections.additionalSections || ""}

\\end{document}`;
}
